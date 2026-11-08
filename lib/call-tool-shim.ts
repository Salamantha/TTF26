// Outside ChatGPT there is no window.openai; this stand-in calls the same MCP tools over HTTP so the
// widget's profile switch, race timer and feedback buttons work on the plain web page too.
export const CALL_TOOL_SHIM = `
window.openai = window.openai || {};
window.openai.callTool = async function (name, args) {
  var r = await fetch("/api/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: "tools/call", params: { name: name, arguments: args } }) });
  var t = await r.text(), line = t.split("\\n").find(function (l) { return l.indexOf("data: ") === 0; });
  var m = JSON.parse(line ? line.slice(6) : t);
  if (m.error) throw new Error(m.error.message);
  return m.result;
};`;

