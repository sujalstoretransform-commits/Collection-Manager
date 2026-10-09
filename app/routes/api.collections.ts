import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

const COLLECTION_QUERY = `#graphql
        query Collections($first: Int!, $after: String) {
            collections(first: $first, after: $after) {
                nodes {
                    id
                    title
                    handle
                    handle
                    descriptionHtml
                    sortOrder
                    templateSuffix
                    productsCount{
                        count
                    }
                }
                pageInfo {
                    hasNextPage
                    endCursor 
                }
            }
        }
    `;

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const { admin } = await authenticate.admin(request);

    const response = await admin.graphql(COLLECTION_QUERY, {
        variables: {
            first: 50,
            after: null
        }
    })

    const result = await response.json();

    return result;
};