# shelly_hue_v2
**Integrating Hue Lights with Shelly Switch Relays and Hue Dial Switches**

Are your parents, kids or spouse messing up the joy of controlling Hue lights through the app because they've flicked a light switch or two? Well worry no more, because this project shows you how to solve that problem using scripts that you can run from Shelly relays, enabling seamless integration and automation. Like similar projects out there using the (depracated) Hue V1 API, the goal of this project is to make light switches smarter without relying solely on the Hue ecosystem.

---

## **Motivation**

The project was born out of the following challenges:

1. **Huge Hue API update**: Philips Hue released a completely new Hue V2 API, which includes new feature such as dynamic scenes, gradient entertainment technology, and proactive state change events on the local network. 
2. **Good artists copy, great artists steal**: I didn't want to put any effort into understanding the APIs and writing my own scripts, but all I could find was public repos using the Hue V1 API and they were missing features that I was looking for which turned out to be exclusive to Hue V2 API. So after a hard-headed month of failed Google searches and procrastinating, I caved and started reading API documentation. I use Hue V1 API scripts that I encountered during my tussle with Google - made a few tweaks here and there - and voilá! (Needless to say, I took the liberty of re-using some descriptions from repos like https://github.com/laurentbroering/shelly_hue/tree/main)
3. **Hue Ecosystem Limitations**: Automations within the Hue system are restricted to its ecosystem.
4. **Cost and Maintenance**: Replacing traditional switches with Hue switches is expensive, redundant, and requires frequent battery replacements.
5. **Relay Battery Life**: Hue relay batteries need replacement every couple of years. Shelly relays are powered with a Neutral wire.
6. **Extended Automation Capabilities**: Automating devices like bathroom ventilation requires actual relays, which are unsupported by Hue.
7. **Google Home Constraints**: Google Home automations, even with its Script Editor, lack flexibility—e.g., events from Hue Dial Switches or Shelly devices cannot be used as triggers.

---

## **Caveats**

1. Using scripts like these requires Hue smart lights to be constantly powered. To do so, either set the Shelly relay to *Detached mode* or (hacky solution) do not use the input (I) and output (O) ports of the Shelly relay by doing the following:
   - When following the schema from the Shelly manual, the live wire (typically brown following IEC standards) is usually split between the I-port and the L-port. Remove it from the I-Port or simply don't put one in there in the first place.
   - Also remove the load wire (black) that is in the O-port. Now connect that load wire, which should be coming from the light fixture, directly to the live wire (brown) with a Wago connector.
   - The Shelly relay can now be used as a remote that sends signals to Hue light by using the Hue API.
   - An example of this hack is given by Sascha from @shellyparts in the following video: https://www.youtube.com/watch?v=xwTSj0pG_6M
2. The Hue Bridge does not support JavaScript scripts directly.
3. The JavaScript accepted by scripts that run on Shelly relays is limited. Details on this can be found in Shelly API documentation.
4. I based my scripts on the use of a push button instead of a rocker switch. When using a switch, adjust the list of expected events in the Shelly handler accordingly. Docs:
   - https://shelly-api-docs.shelly.cloud/gen2/DynamicComponents/Virtual/Button#buttontrigger
   - https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/Switch
5. These scripts are based on the Shelly API documentation for *Gen2+* devices. For specifics about what this entails, visit: https://shelly-api-docs.shelly.cloud/gen2/0.14/
6. Although it is possible to set specific colors for lights directly, I found that it is much easier and faster to activate Hue Scenes. While my scripts activate two scenes based on double press actions or triple press actions, it is possible to loop through a longer list of scenes if you wish to do so.
7. By default, the Hue Bridge IP is assigned dynamically, which means that it gets a new IP every time you reconnect it to power or your network. Either change your router settings to give it a static IP or use the helper functions in my scripts to handle *dynamic IP changes*.
8. SSL certificate validation is not needed in a typical consumer home, unless your anarchic teen decides to pick up cyber security studies and wants to mess with you by staging a man-in-the-middle attack on your home network.

---

## **Setup Instructions**

### **Hue Integration**

1. **Discover the Hue Bridge IP**:
   - To retrieve your Hue Bridge IP, access: https://discovery.meethue.com/ or open the Hue app on your phone and look up: `Settings > Bridges > [click on your bridge name] > IP-address`

2. **Create an API Token (Username)**:
   - Sign up to developers.meethue.com and follow their instructions under 'Getting Started': https://developers.meethue.com/develop/hue-api-v2/getting-started/, which I summarize as:
   - Download, install, and open the Postman tool (or any other API testing tool to your liking) and disable ‘SSL certificate verification’ in File – Settings menu.
   - Perform a POST-call with the following settings:
       - URL: `https://<bridge ip address>/api`
       - Body: `{"devicetype":"app_name#instance_name", "generateclientkey":true}`
       - Method: `POST`
   - Press the physical button on the Hue Bridge and perform the previous POST-call again.
   - Copy the username from the response. You need this token to interact with your Hue system via API calls.
   - This is the `<Hue Bridge application key>` that my scripts require.

3. **Explore Your System**:
   - Retrieve information about lamps, groups, scenes, and sensors using commands like these:
   #### Example API Commands:
   - Retrieve all rooms:
     ```
     URL: `https://<bridge ip address>/clip/v2/resource/room`
     Headers: `{hue-application-key (Key): <your-hue-app-key> (Value)}`
     Method: `GET`
     ```
  - Retrieve lights from the list of devices (look up 'rtype: light' and use the corresponding 'rid' to control a light source):
     ```
     URL: `https://<bridge ip address>/clip/v2/resource/device`
     Headers: `{hue-application-key (Key): <your-hue-app-key> (Value)}`
     Method: `GET`
     ```
   - Turn off lamp 4:
     ```
     URL: `https://<bridge ip address>/clip/v2/resource/light/<rid-from-light>`
     Method: `PUT`
     Body: `{"on":{"on": false}}`
     ```

   #### Other Useful Endpoints:
   | Endpoint                                 | Description                                 |
   |------------------------------------------|---------------------------------------------|
   | `/clip/v2/resource/light`                | Get information about all lights.           |
   | `/clip/v2/resource/room/<rid>`           | Get details about a specific room.          |
   | `/clip/v2/resource/zone`                 | Get information about all zones.            |
   | `/clip/v2/resource/scene`                | Get information about all scenes.           |
   | `/clip/v2/resource/smart_scene`          | Get information about all dynamic scenes.   |
   | `/clip/v2/resource/grouped_light/<rid>`  | Get details about specific grouped lights.  |

---

### **Shelly Integration**

1. **Configure Relays**:
   - Set Shelly relays to *Button* and *Detached Mode*, or adjust the wire schema as mentioned above.

2. **Add Scripts**:
   - Open the Shelly script editor.
   - Add the scripts provided in this repository.
   - Save and start the scripts.

3. **Test and Troubleshoot**:
   - Adjust parameters as needed to ensure proper functionality.
   - If customize a script and it malfunctions, it might seem like you have bricked your Shelly at some point. When this happens, first check whether you set the relay to *Button-mode* correctly. 9 out of 10-times, that was the issue for me.

---

## **Conclusion**

This project provides a cost-effective solution to integrate Hue lights with Shelly relays while overcoming ecosystem limitations and automation constraints. By leveraging open APIs and scripting capabilities, you can achieve advanced home automation without expensive proprietary hardware.
