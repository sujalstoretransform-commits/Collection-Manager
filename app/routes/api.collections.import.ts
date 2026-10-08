import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

const COLLECTION_CREATE_MUTATION = `#graphql
    mutation Collectioncreate($collection: CollectionCreateInput!) {
        collectionCreate(collection: $collection){
            collection {
                id
                title
                handle
            }
            userErrors {
                field
                message
            }
        }
    }
`;

export async function action({ request }: ActionFunctionArgs) {
    const { admin } = await authenticate.admin(request);

    try {

        const body = await request.json()

        if (!Array.isArray(body.collections)) {
            return Response.json(
                { error: "collections must be empty" },
                { status: 400 }
            )
        }

        const results = [];

        for (const collection of body.collections) {
            const response = await admin.graphql(COLLECTION_CREATE_MUTATION, {
                variables: {
                    collection: {
                        title: collection.title,
                        handle: collection.handle,
                        descriptionHtml: collection.descriptionHtml || ""
                    }
                }
            })

            const result = await response.json()

            const userErrors =
                result.data?.collectionCreate?.userErrors ?? [];

            if (userErrors.length > 0) {
                results.push({
                    handle: collection.handle,
                    status: "failed",
                    errors: userErrors,
                });
                continue;
            }

            results.push({
                handle: collection.handle,
                status: "created",
                collection: result.data.collectionCreate.collection,
            });
        }

        return Response.json({
            success: true,
            results
        })

    } catch (error) {
        return Response.json(
            { error: error instanceof Error ? error.message : "Failed to import collections.", },
            { status: 500 }
        );
    }
}