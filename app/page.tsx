export default function Home() {
  return (
    <main style={{ fontFamily: "sans-serif", padding: 24, maxWidth: 640 }}>
      <h1>TTF Accessible Route Finder</h1>
      <p>
        This is the MCP server backing the accessible route finder. Point an MCP-aware client (ChatGPT
        Developer Mode, Claude, etc.) at:
      </p>
      <pre style={{ background: "#f4f4f4", padding: 12, borderRadius: 6 }}>
        {"<this-deployment-url>"}/api/mcp
      </pre>
      <p>
        Or view a route directly: <a href="/map?route=entrance_west,foyer,halle1,corridor_north,halle2">example map</a>
      </p>
    </main>
  );
}
