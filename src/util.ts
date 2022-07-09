import { Edge, Vertex, WeightedGraph } from "./WeightedGraph";

function byWeight(a: Edge, b: Edge) {
  return b.weight - a.weight;
}

export function adjacentVerticesByWeight<V extends Vertex>(
  graph: WeightedGraph<V>,
  vertex: V
) {
  return graph
    .vertexEdges(vertex)
    .sort(byWeight)
    .map((edge) => graph.getVertex(edge.vertexIds[1]) as V);
}

export function* verticesByWeight<V extends Vertex>(
  graph: WeightedGraph<V>,
  vertex: V
) {
  const nextVertices = [vertex];
  const visited = [vertex.id];

  while (true) {
    const current = nextVertices.shift();
    if (!current) break;

    const vertices = adjacentVerticesByWeight(graph, current).filter(
      (v) => !visited.includes(v.id)
    );

    for (let v of vertices) {
      nextVertices.push(v);
      visited.push(v.id);
      yield v;
    }
  }
}
