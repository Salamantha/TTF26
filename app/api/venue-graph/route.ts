import { NODES, EDGES } from "@/lib/venue";
import { getObstacles } from "@/lib/store";

export async function GET() {
  const obstacles = await getObstacles();
  return Response.json({ nodes: NODES, edges: EDGES, obstacles });
}
