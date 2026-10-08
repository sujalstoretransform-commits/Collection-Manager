import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

const COLLECTION_QUERY = `#graphql
  query CollectionsForExistingHandles($first: Int!, $after: String) {
        collections(first: $first, after: $after) {
            nodes {
                handle
            }

            pageInfo {
                hasNextPage
                endCursor
            }
        }
    }
`;

export async function action({ request }: ActionFunctionArgs) {
    const { admin } = await authenticate.admin(request);

    try {
        let after: string | null = null;
        const handles: string[] = [];

        do {
            const response: any = await admin.graphql(COLLECTION_QUERY, {
                variables: {
                    first: 250,
                    after,
                },
            });

            const result = await response.json()

            if (result.errors) {
                throw new Error(
                    result.errors[0]?.message ?? "Shopify API error"
                );
            }

            const data = result.data.collections

            handles.push(
                ...data.nodes.map((collection: { handle: string }) =>
                    collection.handle.toLowerCase()
                )
            )

            after = data.pageInfo.hasNextPage
                ? data.pageInfo.endCursor
                : null;

        } while (after);

        return Response.json(
            { handles }
        )

    } catch (error) {
        return Response.json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to load existing collections.",
            },
            { status: 500 }
        );
    }
}
