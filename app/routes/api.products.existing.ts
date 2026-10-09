import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

const PRODUCTS_QUERY = `#graphql
  query ProductsByHandles($query: String!, $first: Int!) {
    products(first: $first, query: $query) {
      nodes {
        handle
      }
    }
  }
`;

export async function action({ request }: ActionFunctionArgs) {
  const { admin } = await authenticate.admin(request);

  try {
    const body = await request.json();
    const handles = body.handles;

    if (!Array.isArray(handles)) {
      return Response.json(
        { error: "handles must be an array." },
        { status: 400 }
      );
    }

    const existingHandles: string[] = [];

    // Shopify search query can handle batches of product handles.
    const batchSize = 50;

    for (let i = 0; i < handles.length; i += batchSize) {
      const batch = handles.slice(i, i + batchSize);

      const query = batch
        .map((handle: string) => `handle:${handle}`)
        .join(" OR ");

      const response = await admin.graphql(PRODUCTS_QUERY, {
        variables: {
          query,
          first: 250,
        },
      });

      const result = await response.json();

      if (result.errors) {
        throw new Error(
          result.errors[0]?.message ?? "Shopify API error"
        );
      }

      existingHandles.push(
        ...result.data.products.nodes.map(
          (product: { handle: string }) =>
            product.handle.toLowerCase()
        )
      );
    }

    return Response.json({
      handles: existingHandles,
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to check existing products.",
      },
      { status: 500 }
    );
  }
}