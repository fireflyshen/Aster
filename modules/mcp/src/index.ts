import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { connectWorkspace } from "./transport.ts";
import { createAiServer } from "./server.ts";

const workspace = await connectWorkspace();
const server = createAiServer(workspace.call);
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await server.close();
  await workspace.close();
}
process.on("SIGINT", () => {
  void close().finally(() => process.exit(0));
});
process.on("SIGTERM", () => {
  void close().finally(() => process.exit(0));
});
const transport = new StdioServerTransport();
await server.connect(transport);
// Preserve SDK close handling and release the SSH tunnel on host disconnect.
const onclose = transport.onclose;
transport.onclose = () => {
  onclose?.();
  void close();
};
