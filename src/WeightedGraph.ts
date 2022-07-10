import EventEmitter from "events";

export interface Vertex {
  id: string;
}

export interface ConnectedEdge {
  id: EdgeId;
  vertexIds: [string, string];
  weight: number;
}
export type NullEdge = { id: "null"; weight: 0 };
const nullEdge: NullEdge = { id: "null", weight: 0 };
export type Edge = ConnectedEdge | NullEdge;
export function isNullEdge(edge: Edge): edge is NullEdge {
  return edge.id === "null";
}
export function isConnectedEdge(edge: Edge): edge is ConnectedEdge {
  return !isNullEdge(edge);
}

type IdOrVertex = Vertex | string;
export type EdgeId = `${string}-${string}`;

const vertexToId = (vertex: IdOrVertex): string =>
  typeof vertex === "string" ? vertex : vertex.id;

const edgeId = (from: IdOrVertex, to: IdOrVertex): EdgeId => {
  const [fromId, toId] = [from, to].map(vertexToId).sort();
  return `${fromId}-${toId}`;
};

function setToArray(set: Set<any>) {
  return [...set];
}

function mapToObject(map: Map<string, any>) {
  const obj: { [index: string]: any } = {};
  map.forEach((value, key) => {
    obj[key] = value instanceof Set ? setToArray(value) : value;
  });
  return obj;
}

function objectToMap(obj: { [index: string]: any }) {
  return Object.entries(obj).reduce((map, [id, v]) => {
    if (Array.isArray(v)) {
      map.set(id, new Set(v));
    } else {
      map.set(id, v);
    }
    return map;
  }, new Map<string, any>());
}

export class WeightedGraph<V extends Vertex> extends EventEmitter {
  verts = new Map<string, V>();
  edges = new Map<EdgeId, Edge>();
  edgeMap = new Map<string, Set<EdgeId>>();

  constructor() {
    super();
  }

  clear() {
    this.verts.clear();
    this.edges.clear();
    this.edgeMap.clear();
    this.emit("onClear");
  }

  addVertex(vertex: V) {
    const { id } = vertex;
    this.verts.set(id, vertex);

    this.emit("onVertexAdded", id);
  }

  addEdge(from: IdOrVertex, to: IdOrVertex, weight: number) {
    const [fromId, toId] = [from, to].map(vertexToId);

    if (![fromId, toId].every(this.hasVertex.bind(this))) {
      throw new Error("Must add vertex before adding edges");
    }
    const id = edgeId(fromId, toId);
    this.edges.set(id, {
      id: id,
      vertexIds: [fromId, toId],
      weight,
    });
    this.edgeMap.set(fromId, (this.edgeMap.get(fromId) || new Set()).add(id));
    this.edgeMap.set(toId, (this.edgeMap.get(toId) || new Set()).add(id));

    this.emit("onEdgeAdded", id);
  }

  addToEdge(from: IdOrVertex, to: IdOrVertex, weight: number) {
    const id = edgeId(from, to);
    const edge = this.edges.get(id);
    this.addEdge(from, to, (edge?.weight || 0) + weight);
  }

  hasVertex(id: IdOrVertex) {
    return this.verts.has(vertexToId(id));
  }

  isConnected(from: IdOrVertex, to: IdOrVertex) {
    return this.edges.has(edgeId(from, to));
  }

  getVertex(id: string) {
    return this.verts.get(id);
  }

  getEdge(id: EdgeId) {
    return this.edges.get(id) || nullEdge;
  }

  vertexEdges(id: IdOrVertex): ConnectedEdge[] {
    const vertId = vertexToId(id);
    const edgeIds = this.edgeMap.get(vertId) || new Set();
    return [...edgeIds]
      .map(this.getEdge.bind(this))
      .filter(isConnectedEdge)
      .map((edge) => ({
        ...edge,
        vertexIds:
          edge.vertexIds[0] === vertId
            ? edge.vertexIds
            : [edge.vertexIds[1], edge.vertexIds[0]],
      }));
  }

  adjacentVertices(id: IdOrVertex): V[];
  adjacentVertices(
    id: IdOrVertex,
    edgeFilter?: (edge: ConnectedEdge) => Boolean
  ): V[] {
    const vertId = vertexToId(id);
    let edges = this.vertexEdges(vertId);

    if (edgeFilter) edges = edges.filter(edgeFilter);

    return edges.map((edge) => this.getVertex(edge.vertexIds[1]) as V);
  }

  validate() {
    this.edges.forEach((edge) => {
      if (isConnectedEdge(edge)) {
        edge.vertexIds.forEach((id) => {
          if (!this.hasVertex(id)) {
            throw new Error(
              `Invalid edge connecting ${edge.vertexIds.join(", ")}`
            );
          }
        });
      }
    });
  }

  toJSON() {
    return {
      verts: mapToObject(this.verts),
      edges: mapToObject(this.edges),
      edgeMap: mapToObject(this.edgeMap),
    };
  }

  static fromJSON<V extends Vertex>(raw: any) {
    const data = raw as {
      verts: { [index: string]: V };
      edges: { [index: EdgeId]: Edge };
      edgeMap: { [index: string]: EdgeId[] };
    };
    const graph = new WeightedGraph<V>();

    graph.verts = objectToMap(data.verts);
    graph.edges = objectToMap(data.edges) as any;
    graph.edgeMap = objectToMap(data.edgeMap);
    graph.validate();

    return graph;
  }
}
