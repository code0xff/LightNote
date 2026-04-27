# LightNote

LightNote has been developed utilizing [SvelteKit](https://kit.svelte.dev), [Tiptap](https://tiptap.dev), and [shadcn/ui](https://ui.shadcn.com/) to ensure accessibility even in offline environments.

Documents are stored locally in **IndexedDB**. LightNote keeps multiple documents on the device, restores the last opened document, and automatically saves edits. You can export the active document as an HTML file, and imported HTML files are added as new documents.

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

If it is not possible to provide the hosting endpoint over HTTPS, you can use the [ngrok](https://ngrok.com) proxy to expose it via HTTPS. After signing up for ngrok and obtaining the token, use the command below to expose the previously launched server over HTTPS.

    ngrok http http://localhost:1234

Finally, connect to the relay server using the ngrok proxy address and workspace name.

[https://code0xff.github.io/LightNote?endpoint={proxy_url}&workspace={workspace}](https://code0xff.github.io/LightNote?endpoint={proxy_url}&workspace={workspace})

Now, collaboration mode is active!

---

### License

LightNote is released under the MIT License. See LICENSE for details.
