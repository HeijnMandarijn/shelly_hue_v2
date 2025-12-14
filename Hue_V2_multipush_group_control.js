// ================================================================
// Hue V2 Group/Scene Control via customized Shelly button Events
// - Long-press functionality to emulate continuous dimming
// - Timers for multi-click detection, which slows down quick push response
// - "events" can be "single_push", "double_push", "triple_push", "long_push", "btn_down", or "btn_up"
//   but this script only uses "btn_down" and "btn_up" to customize long push logic
// ================================================================

// == Script Configuration ==
const CONFIG = {
  // Optional: set a static Hue Bridge IP here.
  // If omitted, the script uses the last known IP below and will try discovery on failure.
  // ip: "<hue-bridge-ip>",
  user: "<hue-app-key>", // Hue Bridge application key

  // Targeting (choose ONE approach)  
  // 1) For group toggle: prefer a room or zone (recommended)
  // When using zones, leave the room list empty. Room list will be prioritized over zone list by default.
  rooms: ["<rid>"], // Hue Room IDs (rids)
  /* OPTIONAL:
  List of Room names and IDs:
    ('<rid>', "<name of room>")
  */
  zones: [], // Hue Zone IDs (rids)
  /* OPTIONAL:
  List of Zone names and IDs:
    ('<rid>', "<name of zone>")
  */

  // 2) For single light toggle (optional alternative; not used by default handlers below)
  lights: [], // Hue Light IDs (rids)
  /* OPTIONAL:
  Make a list of all Light bulb names along with their ID, so that it is easier to adjust this script 
  in the future without requiring Hue API calls to see what objects you can choose from:
    ('<rid>', "<name of light>")
  */
  
  // Scenes (used by double/triple push handlers below)
  scenes: [
    "<rid1>", // scene A
    "<rid1>", // scene B
  ], // Hue Scene IDs. You can alternate between two scenes with this script
  /* OPTIONAL:
  List of Scene names and IDs, as well as the name of the room or zone that they apply to:
    ('<rid>', "<name of scene>", "<name of room>")
  */
  
  // Timer settings that determine when to consider short press or long press logic:
  CLICK_TIMEOUT_MS: 400, // Max delay between clicks for multi-push in milliseconds
  LONGPRESS_THRESHOLD_MS: 800, // When to consider press as long press
  INCREMENT_INTERVAL_MS: 500, // Interval for continuous dimming (ms); 1000ms = every second
};
// == End Configuration ==

// =========================================================
// Globals
// =========================================================
let bridge_ip = CONFIG.ip || "192.168.00.00"; // start value; will be updated via discovery if needed

// Track whether we've already retried each function once since last success
let retryState = {
  SingleToggleLightbulb: false,
  SingleToggleGroup: false,
  ActivateScene: false,
  EmulateContinuousDim: false,
};

// Names for functions used in retry logic
const f_SingleToggleLightbulb = 'SingleToggleLightbulb';
const f_SingleToggleGroup = 'SingleToggleGroup';
const f_ActivateScene = 'ActivateScene';
const f_EmulateContinuousDim = 'EmulateContinuousDim';
const f_ResolveGroupedLightRid = "ResolveGroupedLightRid";

// Custom Shelly button state tracking
let btn_state = null;

// global variables linked to Hue API usage
let currBrightness = null;
let targetBrightness = null;
let dimStep  = 25; // Percentage to dim with every interval (default: 10)
let dimDirection  = -1; // Value explanation:
// -1 = dim (lower brightness), +1 = brighten (raise brightness)
// Initial value -1 ensures the *first* long press dims.
let dimRequestInFlight = false; // 'busy' flag to throttle EmulateContinuousDim()
// We only want one dimming chain in flight at any time. 
// If the timer fires while one is still running, we just skip that tick.

// global variables linked to Shelly input handling
let clickCount = 0;
let clickTimer = null; // when this expires, a single/double/triple push is recognized
let isLongPush = false; // Flag to track long press status
let isClickSequence = false; // Flag to track click sequence status
let longpressTimer = null; // when this expires, a long push is performed
let dimTimer = null; // timer for continuous dimming

// =========================================================
// Hue Bridge discovery (for dynamic IP / recovery)
// =========================================================
function overwriteIPnRetry(callback) {
  //Discover hue bridge IPs on the same network. We assume there is only one bridge with this function
  Shelly.call(
	"HTTP.Request", 
	{
	  method: "GET",
	  url: 'https://discovery.meethue.com/',
	  ssl_ca: "*" // Value "*" disables server certificate validation. Do not change this for the discovery call!
	},
	function (res, error_code, error_message, ud) {
	  if (error_code !== 0) {
        console.log("Hue discovery failed. Error:", error_code, error_message);
		if (callback) callback(false);
	  } else {
		let st;
        try {
          st = JSON.parse(res.body);
        } catch (e) {
          console.log("Hue discovery returned invalid JSON.");
          if (callback) callback(false);
          return;
        }

        if (!st || !st.length || !st[0].internalipaddress) {
          console.log("Hue discovery returned no bridge IPs.");
          if (callback) callback(false);
          return;
        }
		
		bridge_ip = st[0].internalipaddress;
        console.log("Hue bridge IP updated to: ", bridge_ip);

		if (callback) callback(true);
	  }
	},null
  );
}

// Generic retry: at most one retry per function_name between successes
function retryFunction(function_name, arg) {
  if (retryState[function_name]) {
    console.log('Too many attempts for "', function_name, '". Not retrying.');
    return;
  }
  retryState[function_name] = true;

  overwriteIPnRetry(function (ok) {
    if (!ok) return;  // This means that IP update failure was already logged

    console.log('Retrying', function_name, 'after IP update');
    if (function_name === f_SingleToggleLightbulb) {
      SingleToggleLightbulb();
    } else if (function_name === f_SingleToggleGroup) {
      SingleToggleGroup();
    } else if (function_name === f_ActivateScene) {
      ActivateScene(arg); // arg = sceneID
    } else if (function_name === f_EmulateContinuousDim) {
      EmulateContinuousDim();
    } else if (function_name === f_ResolveGroupedLightRid) {
      resolveGroupedLightRid(function () {});
    } else {
      console.log("Unknown function for retry:", function_name);
    }
  });
}

// Reset all timers and variables related to click/press handling
function resetState() {
  //console.log("__Reset environment__"); // debug
  if (clickTimer) {
    Timer.clear(clickTimer);
	clickTimer = null;
  } 
  if (longpressTimer) {
    Timer.clear(longpressTimer);
	longpressTimer = null;
  }
  if (dimTimer) {
	Timer.clear(dimTimer);
	dimTimer = null;
  }
	
  clickCount = 0;
  isLongPush = false;
  isClickSequence = false;
	
  // Clear brightness tracking so next long press re-syncs with the bridge
  currBrightness = null;
  targetBrightness = null;
}

// =========================================================
//  Hue API helpers
// =========================================================
function hueRequest(method, path, body, cb) {
  let opts = {
    method: method,
    url: "https://" + bridge_ip + path,
    headers: { "hue-application-key": CONFIG.user },
    ssl_ca: "*", // Hue bridge typically uses self-signed cert; "*" avoids validation errors
  };
  if (body !== null && body !== undefined) {
    opts.body = body;
  }

  Shelly.call("HTTP.Request", opts, function (res, error_code, error_message) {
    cb(res, error_code, error_message);
  });
}

function findRidByKey(servicesArray, keyToFind) {
  for (let i = 0; i < servicesArray.length; i++) {
    if (servicesArray[i].rtype === keyToFind) return servicesArray[i].rid;
  }
  return null;
}

function getGroupOwner() {
  if (CONFIG.rooms && CONFIG.rooms.length > 0) {
    return { type: "room", rid: CONFIG.rooms[0] };
  }
  if (CONFIG.zones && CONFIG.zones.length > 0) {
    return { type: "zone", rid: CONFIG.zones[0] };
  }
  return null;
}

// Resolve and cache grouped_light rid from room/zone
function resolveGroupedLightRid(doneCb) {
  let owner = getGroupOwner();
  if (!owner) {
    console.log("No rooms[] or zones[] configured; cannot resolve grouped_light rid.");
    if (doneCb) doneCb(null);
    return;
  }

  // If cached for same owner, return it
  if (
    cached_grouped_light_rid &&
    cached_group_owner &&
    cached_group_owner.type === owner.type &&
    cached_group_owner.rid === owner.rid
  ) {
    if (doneCb) doneCb(cached_grouped_light_rid);
    return;
  }

  let path = owner.type === "room"
    ? "/clip/v2/resource/room/" + owner.rid
    : "/clip/v2/resource/zone/" + owner.rid;

  hueRequest("GET", path, null, function (res, e, m) {
    if (e !== 0) {
      console.log("resolveGroupedLightRid(); GET failed.", e, m);
      retryFunction(f_ResolveGroupedLightRid);
      if (doneCb) doneCb(null);
      return;
    }

    retryState.ResolveGroupedLightRid = false;

    let st;
    try {
      st = JSON.parse(res.body);
    } catch (err) {
      console.log("resolveGroupedLightRid(); Invalid JSON.");
      if (doneCb) doneCb(null);
      return;
    }

    if (!st.data || !st.data[0] || !st.data[0].services) {
      console.log("resolveGroupedLightRid(); No services found on room/zone.");
      if (doneCb) doneCb(null);
      return;
    }

    let grouped_light_rid = findRidByKey(st.data[0].services, "grouped_light");
    if (!grouped_light_rid) {
      console.log("resolveGroupedLightRid(); No grouped_light service found.");
      if (doneCb) doneCb(null);
      return;
    }

    cached_group_owner = owner;
    cached_grouped_light_rid = grouped_light_rid;
    if (doneCb) doneCb(grouped_light_rid);
  });
}

// =========================================================
// Actions
// =========================================================

// --- Single light toggle (optional) ---
function SingleToggleLightbulb() {
  if (!CONFIG.lights || CONFIG.lights.length === 0) {
    console.log("SingleToggleLightbulb(); No lights[] configured.");
    return;
  }
  
  hueRequest("GET", "/clip/v2/resource/light/" + CONFIG.lights[0], null, function (res, e, m) {
    if (e !== 0) {
      console.log("SingleToggleLightbulb(); GET failed.", e, m);
      retryFunction(f_SingleToggleLightbulb);
      return;
    }

	// Success: allow a fresh retry next time
    retryState.SingleToggleLightbulb = false;

    let st = JSON.parse(res.body);
    let isOn = st.data[0].on.on === true;
    let body = '{"on":{"on":' + (isOn ? "false" : "true") + "}}";

    hueRequest("PUT", "/clip/v2/resource/light/" + CONFIG.lights[0], body, function (r2, e2, m2) {
      if (e2 !== 0) console.log("ToggleLight(); PUT failed.", e2, m2);
    });
  });
}

// --- Group toggle (room/zone via grouped_light) ---
function SingleToggleGroup() {
  resolveGroupedLightRid(function (groupedRid) {
    if (!groupedRid) {
      console.log("SingleToggleGroup(); grouped_light rid unavailable.");
      return;
    }

    hueRequest("GET", "/clip/v2/resource/grouped_light/" + groupedRid, null, function (res, e, m) {
      if (e !== 0) {
        console.log("SingleToggleGroup(); GET grouped_light failed.", e, m);
        retryFunction(f_SingleToggleGroup);
        return;
      }

      retryState.SingleToggleGroup = false;

      let st = JSON.parse(res.body);
      let isOn = st.data[0].on.on === true;
      let body = '{"on":{"on":' + (isOn ? "false" : "true") + "}}";

      hueRequest("PUT", "/clip/v2/resource/grouped_light/" + groupedRid, body, function (r2, e2, m2) {
        if (e2 !== 0) console.log("ToggleGroup(); PUT failed.", e2, m2);
      });
    });
  });
}

// --- Scene activation ---
function ActivateScene(sceneID) {
  if (!sceneID) {
    console.log("ActivateScene(); No sceneID provided.");
    return;
  }

  let body = '{"recall":{"action":"active"}}';
  hueRequest("PUT", "/clip/v2/resource/scene/" + sceneID, body, function (res, e, m) {
    if (e !== 0) {
      console.log("ActivateScene(); PUT failed.", e, m);
      retryFunction(f_ActivateScene, sceneID);
      return;
    }

    retryState.ActivateScene = false;
  });
}

// --- Brightness control for grouped lights ---
function EmulateContinuousDim() {
  // Perform this only while long-press is active; stop when btn_up clears isLongPush
  if(!isLongPush) {
    return;
  }
  
  // Avoid overlapping HTTP call chains
  if (dimRequestInFlight) {
    console.log("EmulateContinuousDim(); previous dim request still running, skipping this tick.");
    return;
  }
  dimRequestInFlight = true;
  
  resolveGroupedLightRid(function (groupedRid) {
    if (!groupedRid) {
      console.log("EmulateContinuousDim(); grouped_light rid unavailable.");
      return;
    }

    hueRequest("GET", "/clip/v2/resource/grouped_light/" + groupedRid, null, function (res, e, m) {
      if (e !== 0) {
        console.log("EmulateContinuousDim(); GET grouped_light failed.", e, m);
		dimRequestInFlight = false;
        retryFunction(f_EmulateContinuousDim);
        return;
      }

      retryState.EmulateContinuousDim = false;
	  
	  if (!isLongPush) {
        dimRequestInFlight = false;
        return;
      }
	  
	  let st = JSON.parse(res.body);	  
	  // Initialize currBrightness for each seperate button press
	  if (currBrightness === null) {
		currBrightness = st2.data[0].dimming.brightness;
	  } else {
		currBrightness = targetBrightness;
	  }
	  
	  if (dimDirection < 0) {
		// dim by dimStep, but never below 1
		targetBrightness = Math.max(1,currBrightness - dimStep) 
	  } else {
		// brighten by dimStep, but never above 100
		targetBrightness = Math.min(100,currBrightness + dimStep) 
	  }
	  
	  let body = '{"dimming":{"brightness":' + targetBrightness + "}}";
	  
	  hueRequest("PUT", "/clip/v2/resource/grouped_light/" + groupedRid, body, function (r2, e2, m2) {
	    if (e2 !== 0) console.log("SetBrightnessGroup(); PUT failed.", e2, m2);
		dimRequestInFlight = false;
	  });			 
    });
  });
}

// =========================================================
// Shelly input handling (Custom push events)
// =========================================================

// --- handlers for short push events ---
function handleSinglePush() {
  console.log(">>> SINGLE PUSH <<<");
  // Choose what single push does:
  SingleToggleGroup();
  // Or: SingleToggleLightbulb();
}

function handleDoublePush() {
  console.log(">>> DOUBLE PUSH <<<");
  if (!CONFIG.scenes || CONFIG.scenes.length < 1) {
    console.log("No scenes[0] configured.");
    return;
  }
  ActivateScene(CONFIG.scenes[0]);
}

function handleTriplePush() {
  console.log(">>> TRIPLE PUSH <<<");
  if (!CONFIG.scenes || CONFIG.scenes.length < 2) {
    console.log("No scenes[1] configured.");
    return;
  }
  ActivateScene(CONFIG.scenes[1]);
}

function processClickSequence() {
  // If a long press was registered, ignore any pending short press logic
  if (isLongPush) {
	resetState();
    return;
  }
  isClickSequence = true;
	
  // Decide which click pattern we saw
  if (clickCount === 1) {
	handleSinglePush();
  } else if (clickCount === 2) {
	handleDoublePush();
  } else if (clickCount === 3) {
	handleTriplePush();
  } else if (clickCount > 3) { 
	console.log("Unhandled: ", clickCount, " pushes. Ignore input."); 
  }
  
  resetState();
}

// --- handlers for long push events ---
function handleLongPush() {
  // Safety: only treat as long press if the button is still down
  if (btn_state === "btn_up") {
    return;
  }
  
  console.log(">>> LONG PUSH <<<");
  isLongPush = true;
  
  // Reset brightness tracking for this *new* long press
  currBrightness = null;

  // First dim step immediately...
  EmulateContinuousDim();

  // ...Followed by continuous dimming per interval
  dimTimer = Timer.set(
	CONFIG.INCREMENT_INTERVAL_MS,
	true, // repeating
	EmulateContinuousDim
  );
}

// Main handler
Shelly.addEventHandler(function (event, user_data) {
  // Limit to input:0 events only
  if (!event || !event.info || event.info.component !== "input:0") return;

  let e = event.info.event;
	
  if (e === "btn_down") {
	btn_state = e;
	// (Re)start long-press timer; if it fires, we will treat this as a long press
    if (longpressTimer) {
      Timer.clear(longpressTimer);
      longpressTimer = null;
    }
	// Set a new timer to process a long press after a short delay
	longpressTimer = Timer.set(
	  CONFIG.LONGPRESS_THRESHOLD_MS, 
	  false,
	  handleLongPush
	);
	return;
  }

  if (e === "btn_up") {	
	btn_state = e;
	// If we already recognized a long press, this 'up' ends it
	if (isLongPush) {
	  // Stop continuous dimming if running
	  if (dimTimer) {
		Timer.clear(dimTimer);
		dimTimer = null;
	  }	
	  // Toggle direction for the *next* long press:
	  // if we just dimmed, next long press will brighten; if we just brightened, it will dim.
	  dimDirection = -dimDirection;
	  // End of long press; do NOT treat as a click
      resetState();
      return;
	}
	
	// Not a long press: it's part of a click sequence
	if (longpressTimer) {
	  Timer.clear(longpressTimer);
	  longpressTimer = null;
	}
	// Count this click
	clickCount++;
	// (Re)start clickTimer: when it fires with no new clicks,
    // we process the sequence (single/double/triple)
	if (clickTimer) {
	  Timer.clear(clickTimer);
	  clickTimer = null;
	}
	clickTimer = Timer.set(
	  CONFIG.CLICK_TIMEOUT_MS, 
	  false, 
	  processClickSequence
	);  
	return;
  }
});

// Optional: warm up the grouped_light cache at script start
resolveGroupedLightRid(function (rid) {
  if (rid) console.log("Cached grouped_light rid:", rid);
});
