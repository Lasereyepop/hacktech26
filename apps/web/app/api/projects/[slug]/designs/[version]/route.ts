import { NextResponse } from "next/server";
import type { DesignDocumentJson, DesignNode } from "@/lib/types";
import {
  createDesignDocumentNode,
  deleteDesignDocumentNodes,
  patchDesignDocument,
  updateDesignDocumentNode,
} from "@/lib/server/project-store";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string; version: string }> },
) {
  const { slug, version } = await params;
  const parsedVersion = Number.parseInt(version, 10);

  if (!Number.isInteger(parsedVersion) || parsedVersion < 1) {
    return NextResponse.json(
      { error: "A valid design version is required." },
      { status: 400 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    operation?: "append-node" | "remove-nodes" | "update-node";
    documentJson?: DesignDocumentJson;
    node?: DesignNode;
    nodeId?: string;
    nodeIds?: string[];
    bounds?: DesignNode["bounds"];
    props?: Record<string, unknown>;
    name?: string;
  };

  if (body.operation === "append-node") {
    if (!body.node || typeof body.node.id !== "string") {
      return NextResponse.json(
        { error: "A valid node is required." },
        { status: 400 },
      );
    }

    const design = createDesignDocumentNode(slug, parsedVersion, body.node);

    if (!design) {
      return NextResponse.json(
        { error: "Project or design version not found." },
        { status: 404 },
      );
    }

    return NextResponse.json({ design }, { status: 201 });
  }

  if (body.operation === "remove-nodes") {
    if (!Array.isArray(body.nodeIds)) {
      return NextResponse.json(
        { error: "nodeIds is required." },
        { status: 400 },
      );
    }

    const design = deleteDesignDocumentNodes(slug, parsedVersion, body.nodeIds);

    if (!design) {
      return NextResponse.json(
        { error: "Project or design version not found." },
        { status: 404 },
      );
    }

    return NextResponse.json({ design }, { status: 201 });
  }

  if (body.operation === "update-node") {
    if (typeof body.nodeId !== "string" || !body.nodeId.trim()) {
      return NextResponse.json(
        { error: "nodeId is required." },
        { status: 400 },
      );
    }

    const design = updateDesignDocumentNode(slug, parsedVersion, {
      nodeId: body.nodeId,
      bounds: body.bounds,
      props: body.props,
      name: body.name,
    });

    if (!design) {
      return NextResponse.json(
        { error: "Project or design version not found." },
        { status: 404 },
      );
    }

    return NextResponse.json({ design }, { status: 201 });
  }

  if (!body.documentJson || !Array.isArray(body.documentJson.views)) {
    return NextResponse.json(
      {
        error:
          "documentJson with views, append-node, update-node, or remove-nodes is required.",
      },
      { status: 400 },
    );
  }

  const design = patchDesignDocument(slug, parsedVersion, body.documentJson);

  if (!design) {
    return NextResponse.json(
      { error: "Project or design version not found." },
      { status: 404 },
    );
  }

  return NextResponse.json({ design }, { status: 201 });
}
