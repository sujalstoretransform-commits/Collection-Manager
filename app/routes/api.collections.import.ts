import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

const COLLECTION_CREATE_MUTATION = `#graphql
    mutation Collectioncreate($collection: CollectionCreateInput!) {
        collectionCreate(collection: $collection){
            collection {
                id
                title
                handle
                sources{
                    __typename
                    id
                    title
                }
            }
            userErrors {
                field
                message
            }
        }
    }
`;


const PRODUCTS_BY_HANDLES_QUERY = `#graphql
  query ProductsByHandles($query: String!, $first: Int!) {
    products(first: $first, query: $query) {
      nodes {
        id
        handle
      }
    }
  }
`;


const COLLECTION_ADD_PRODUCTS_MUTATION = `#graphql
  mutation CollectionAddProducts($id: ID!, $productIds: [ID!]!) {
    collectionAddProducts(id: $id, productIds: $productIds) {
      collection {
        id
        title
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const buildSmartConditions = (conditions: any[]) => {
    return conditions.map((rule) => {
        const field = String(rule.column ?? rule.field ?? "").toUpperCase()
        const relation = String(rule.relation ?? "").toUpperCase()
        const value = String(
            rule.condition
            ?? (Array.isArray(rule.values) ? rule.values[0] : rule.values)
            ?? ""
        ).trim()

        if (field === "TAG") {
            let tagRelation: string

            if (relation === "EQUALS") {
                tagRelation = 'TAGGED_WITH'
            }
            else if (relation === "NOT_EQUALS") {
                tagRelation = "NOT_TAGGES_WITH"
            }
            else {
                throw new Error(`Back Unsupported TAG relation: ${relation}`);
            }
            return {
                productTag: {
                    relation: tagRelation,
                    values: [value],
                    matchType: "ANY"
                }
            }
        }

        throw new Error(`Back Unsupported condition field: ${field}`);
    })
}

export async function action({ request }: ActionFunctionArgs) {
    const { admin } = await authenticate.admin(request);

    try {
        const body = await request.json()

        console.log(
            "IMPORT CONDITIONS:",
            JSON.stringify(
                body.collections?.map((c: any) => ({
                    handle: c.handle,
                    type: c.type,
                    matchType: c.matchType,
                    conditions: c.conditions,
                })),
                null,
                2
            )
        );

        if (!Array.isArray(body.collections)) {
            return Response.json(
                { error: "collections must be an array" },
                { status: 400 }
            )
        }

        const results = [];

        for (const collection of body.collections) {

            let productIds: string[] = [];
            const isManual = String(collection.type).toLowerCase() === "manual"

            if (
                isManual &&
                Array.isArray(collection.productHandles) &&
                collection.productHandles.length > 0
            ) {
                const productHandles = collection.productHandles
                    .map((handle: string) => handle.trim())
                    .filter(Boolean);

                const productQuery = productHandles
                    .map((handle: string) => `handle:${handle}`)
                    .join(" OR ");

                const productsResponse = await admin.graphql(
                    PRODUCTS_BY_HANDLES_QUERY,
                    {
                        variables: {
                            query: productQuery,
                            first: 250
                        }
                    }
                )

                const productsResult = await productsResponse.json();

                if (productsResult.errors) {
                    results.push({
                        handle: collection.handle,
                        status: "failed",
                        errors: productsResult.errors,
                    });

                    continue;
                }

                const products = productsResult.data?.products?.nodes ?? [];

                const foundHanldes = new Set(
                    products.map((product: { handle: string }) => product.handle.toLowerCase())
                )

                const missingHandles = productHandles.filter((handle: string) => !foundHanldes.has(handle.toLowerCase()))

                if (missingHandles.length > 0) {
                    results.push({
                        handle: collection.handle,
                        status: "failed",
                        errors: [
                            {
                                message: `Products not found: ${missingHandles.join(", ")}`,
                            },
                        ],
                    })
                    continue
                }

                productIds = products.map(
                    (product: { id: string }) => product.id
                );
            }

            const collectionInput: Record<string, unknown> = {
                title: collection.title,
                handle: collection.handle,
                descriptionHtml: collection.descriptionHtml || "",
            }

            if (collection.sortOrder) {
                collectionInput.sortOrder = collection.sortOrder
            }

            if (collection.templateSuffix) {
                collectionInput.templateSuffix = collection.templateSuffix;
            }

            if (!isManual && Array.isArray(collection.conditions)) {
                collectionInput.sources = [
                    {
                        source: {
                            title: "Imported smart collection rules",
                            inclusion: {
                                matchType: String(collection.matchType).toUpperCase() === "ANY" ? "ANY" : "ALL",
                                conditions: buildSmartConditions(collection.conditions)
                            }
                        }
                    }
                ]
            }

            const response = await admin.graphql(COLLECTION_CREATE_MUTATION, {
                variables: {
                    collection: collectionInput
                }
            })

            const result = await response.json()

            if (result.errors) {
                results.push({
                    handle: collection.handle,
                    status: "failed",
                    errors: result.errors,
                });

                continue;
            }

            const userErrors = result.data?.collectionCreate?.userErrors ?? [];

            if (userErrors.length > 0) {
                results.push({
                    handle: collection.handle,
                    status: "failed",
                    errors: userErrors,
                });
                continue;
            }

            const createdCollection = result.data.collectionCreate.collection
            console.log("CREATED COLLECTION:", createdCollection);

            if (isManual && productIds.length > 0) {
                const addProductsResponse = await admin.graphql(
                    COLLECTION_ADD_PRODUCTS_MUTATION,
                    {
                        variables: {
                            id: createdCollection.id,
                            productIds,
                        },
                    }
                );

                const addProductsResult = await addProductsResponse.json();

                if (addProductsResult.errors?.length) {
                    results.push({
                        handle: collection.handle,
                        status: "failed",
                        errors: addProductsResult.errors,
                    });
                    continue;
                }

                const addProductsUserErrors =
                    addProductsResult.data?.collectionAddProducts?.userErrors ?? [];

                if (addProductsUserErrors.length > 0) {
                    results.push({
                        handle: collection.handle,
                        status: "failed",
                        errors: addProductsUserErrors,
                    });
                    continue;
                }

            }

            results.push({
                handle: collection.handle,
                status: "created",
                collection: createdCollection,
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