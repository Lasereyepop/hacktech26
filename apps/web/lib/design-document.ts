import type { DesignDocumentJson, DesignNode } from "@/lib/types";

export function appendNodeToDocument(
  documentJson: DesignDocumentJson,
  node: DesignNode,
): DesignDocumentJson {
  return {
    ...documentJson,
    views: documentJson.views.map((view) =>
      view.id === node.viewId
        ? { ...view, nodeIds: [...view.nodeIds, node.id] }
        : view,
    ),
    nodes: [...documentJson.nodes, node],
    metadata: {
      ...documentJson.metadata,
      generatedAt: new Date().toISOString(),
    },
  };
}

export function removeNodesFromDocument(
  documentJson: DesignDocumentJson,
  nodeIds: string[],
): DesignDocumentJson {
  const idsToRemove = new Set(nodeIds);

  return {
    ...documentJson,
    views: documentJson.views.map((view) => ({
      ...view,
      nodeIds: view.nodeIds.filter((nodeId) => !idsToRemove.has(nodeId)),
    })),
    nodes: documentJson.nodes.filter((node) => !idsToRemove.has(node.id)),
    metadata: {
      ...documentJson.metadata,
      generatedAt: new Date().toISOString(),
    },
  };
}

export function updateNodeInDocument(
  documentJson: DesignDocumentJson,
  input: {
    nodeId: string;
    bounds?: DesignNode["bounds"];
    props?: Record<string, unknown>;
    name?: string;
  },
): DesignDocumentJson {
  let didUpdate = false;
  const nodes = documentJson.nodes.map((node) => {
    if (node.id !== input.nodeId) {
      return node;
    }

    didUpdate = true;

    return {
      ...node,
      ...(input.name ? { name: input.name } : {}),
      ...(input.bounds ? { bounds: input.bounds } : {}),
      ...(input.props
        ? {
            props: {
              ...node.props,
              ...input.props,
              style:
                input.props.style &&
                typeof input.props.style === "object" &&
                node.props.style &&
                typeof node.props.style === "object"
                  ? {
                      ...(node.props.style as Record<string, unknown>),
                      ...(input.props.style as Record<string, unknown>),
                    }
                  : (input.props.style ?? node.props.style),
            },
          }
        : {}),
    };
  });

  if (!didUpdate) {
    return documentJson;
  }

  return {
    ...documentJson,
    nodes,
    metadata: {
      ...documentJson.metadata,
      generatedAt: new Date().toISOString(),
    },
  };
}
