 LightNote
=========

LightNote has been developed utilizing [SvelteKit](https://kit.svelte.dev), [Tiptap](https://tiptap.dev), and [shadcn/ui](https://ui.shadcn.com/) to ensure accessibility even in offline environments.

LightNote essentially supports three types of headers, basic paragraph type, code block, unordered list, and ordered list types necessary for document creation.

Header types and basic paragraph types can be emphasized with formatting options such as **bold**, _italic_, and ~strike~.

Links can be added or modified through the link button, and they can be removed using the link removal button.

The history feature is also provided through undo and redo actions.

Documents are basically stored in **LocalStorage**, and if you wish to save them permanently, you should use the provided save function to store them as HTML files. Additionally, you can upload these files to continue editing.

The theme supports both Light and Dark modes.

If you want more features, please visit the tiptap documentation and extend the functionality through extensions.

* * *

### Collaboration

LightNote supports collaboration features. LightNote utilizes Tiptap's Collaboration extension and supports cross-device connections through WebSocket, requiring a [Hocuspocus](https://tiptap.dev/docs/hocuspocus/introduction) server for relay. The Hocuspocus server can either be hosted directly or leverage a third-party service that provides the necessary functionality. If Node.js is installed on the device, enter the following command to start the Hocuspocus server.

    npx @hocuspocus/cli --port 1234 --sqlite

If it is not possible to provide the hosting endpoint over HTTPS, you can use the [ngrok](https://ngrok.com) proxy to expose it via HTTPS. After signing up for ngrok and obtaining the token, use the command below to expose the previously launched server over HTTPS.

    ngrok http http://localhost:1234

Finally, connect to the collaboration server using the ngrok proxy address and the randomly generated name.

    {"url":"ws://localhost:1234","name":"random"}

Now, collaboration mode is active!