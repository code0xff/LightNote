# LightNote

LightNote has been developed utilizing [SvelteKit](https://kit.svelte.dev), [Tiptap](https://tiptap.dev), and [shadcn/ui](https://ui.shadcn.com/) to ensure accessibility even in offline environments.

Documents are stored locally in **IndexedDB**. LightNote keeps multiple documents on the device, restores the last opened document, and automatically saves edits. You can export the active document as an HTML file, and imported HTML files are added as new documents.

The document list slides in from the left, and its cards can be dragged into whatever order you want — by the grip on a touch screen, or anywhere on the card with a mouse.

LightNote can also write with you. Open the AI panel from the toolbar, paste your own OpenAI API key, and it will rewrite a selection, continue where you stopped, or take an instruction and edit the document itself. The key is stored only in this browser and is sent directly to OpenAI; there is no server of ours in between.

If you want more features, please visit the Tiptap documentation and extend the functionality through extensions.

---

### Usage

You can use LightNote via the following link:
[https://code0xff.github.io/LightNote](https://code0xff.github.io/LightNote)

This link will take you to the Github page where LightNote is deployed, allowing you to start using it immediately.

---

### Development

Install dependencies and run the local development server.

    npm ci
    npm run dev

Before publishing changes, run the project checks.

    npm run check
    npm run lint
    npm test -- --run
    npm run build

---

### Collaboration

LightNote supports collaboration features. LightNote utilizes Tiptap's Collaboration extension and supports cross-device connections through WebSocket, requiring a [Hocuspocus](https://tiptap.dev/docs/hocuspocus/introduction) server for relay. The Hocuspocus server can either be hosted directly or leverage a third-party service that provides the necessary functionality. If Node.js is installed on the device, enter the following command to start the Hocuspocus server.

    npx @hocuspocus/cli@v2.15.2 --port 1234 --sqlite

LightNote is served over HTTPS, and a page on HTTPS can only open a `wss://` WebSocket — a plain `ws://` address is blocked by the browser. Unless your relay already speaks HTTPS, put the [ngrok](https://ngrok.com) proxy in front of it. After signing up for ngrok and obtaining the token, use the command below to expose the previously launched server over HTTPS.

    ngrok http http://localhost:1234

Finally, connect to the relay server using the ngrok proxy address and workspace name.

[https://code0xff.github.io/LightNote?endpoint={proxy_url}&workspace={workspace}](https://code0xff.github.io/LightNote?endpoint={proxy_url}&workspace={workspace})

Now, collaboration mode is active! Anyone with the endpoint and the workspace name can read and edit the document — the workspace name is the only thing protecting it.

A shared document lives on the relay and in the open page, and is not saved to this browser. If the connection drops, LightNote keeps reconnecting and says so rather than dumping you out of the session; **Save a copy** in the toolbar menu takes what is on screen into a normal local document.

---

### License

LightNote is released under the MIT License. See LICENSE for details.
