import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

const COLLECTION_QUERY = `#graphql
  query CollectionForExport($id: ID!, $first: Int!, $after: String) {
    collection(id: $id) {
      id
      title
      handle
      descriptionHtml
      sortOrder
      templateSuffix

      ruleSet {
        appliedDisjunctively

        rules {
          column
          relation
          condition
        }
      }

      products(first: $first, after: $after) {
        nodes {
          handle
        }

        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
`;

export async function action({ request }: ActionFunctionArgs) {
  const { admin } = await authenticate.admin(request);

  const body = await request.json();

  const ids = body.ids;

  if (!Array.isArray(ids) || ids.length === 0) {
    return Response.json(
      { error: "No collections selected." },
      { status: 400 },
    );
  }

  const collections = [];

  for (const id of ids) {
    let after: string | null = null;
    let collectionData: any = null;
    const productHandles: string[] = [];

    do {
      const response = await admin.graphql(COLLECTION_QUERY, {
        variables: {
          id,
          first: 250,
          after,
        },
      });

      const result = await response.json();

      if (result.errors) {
        throw new Error(result.errors[0]?.message ?? "Shopify API error");
      }

      collectionData = result.data.collection;

      if (!collectionData) {
        throw new Error(`Collection not found: ${id}`);
      }

      productHandles.push(
        ...collectionData.products.nodes.map(
          (product: { handle: string }) => product.handle,
        ),
      );

      const pageInfo = collectionData.products.pageInfo;

      after = pageInfo.hasNextPage
        ? pageInfo.endCursor
        : null;
    } while (after);

    const isSmart = !!collectionData.ruleSet;

    collections.push({
      handle: collectionData.handle,
      title: collectionData.title,
      descriptionHtml: collectionData.descriptionHtml ?? "",
      sortOrder: collectionData.sortOrder,
      templateSuffix: collectionData.templateSuffix,
      type: isSmart ? "smart" : "manual",

      matchType: isSmart
        ? collectionData.ruleSet.appliedDisjunctively
          ? "ANY"
          : "ALL"
        : null,

      conditions: isSmart
        ? collectionData.ruleSet.rules.map((rule: any) => ({
            field: rule.column,
            relation: rule.relation,
            values: [String(rule.condition)],
          }))
        : [],

      productHandles: isSmart ? [] : productHandles,
    });
  }

  return Response.json({
    version: 1,
    exportedAt: new Date().toISOString(),
    collections,
  });
}