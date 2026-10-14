import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getGraphQLErrors } from "../utils/graphql-errors";

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

const VALID_SORT_ORDERS = new Set([
    "ALPHA_ASC",
    "ALPHA_DESC",
    "BEST_SELLING",
    "CREATED",
    "CREATED_DESC",
    "MANUAL",
    "MOST_RELEVANT",
    "PRICE_ASC",
    "PRICE_DESC",
]);

const buildSmartConditions = (conditions: any[]) => {
    return conditions.map((rule) => {
        const field = String(rule.column ?? rule.field ?? "").toUpperCase()
        const relation = String(rule.relation ?? "").toUpperCase()
        const values = Array.isArray(rule.values)
            ? rule.values.map((value: unknown) => String(value).trim()).filter(Boolean)
            : [String(rule.condition ?? rule.values ?? "").trim()].filter(Boolean)

        if (field === "TAG") {
            const tagRelation = relation === "EQUALS"
                ? "TAGGED_WITH"
                : relation === "NOT_EQUALS"
                    ? "NOT_TAGGED_WITH"
                    : relation

            if (!["TAGGED_WITH", "NOT_TAGGED_WITH"].includes(tagRelation)) {
                throw new Error(`Unsupported TAG relation: ${relation}`);
            }

            return {
                productTag: {
                    relation: tagRelation,
                    values,
                    matchType: "ANY"
                }
            }
        }

        const conditionKeyByField: Record<string, string> = {
            TITLE: "productTitle",
            TYPE: "productType",
            VENDOR: "productVendor",
        };
        const conditionKey = conditionKeyByField[field];

        if (conditionKey) {
            const normalizedRelation = relation === "NOT_CONTAINS"
                ? "DOES_NOT_CONTAIN"
                : relation;
            const validRelations = [
                "CONTAINS",
                "DOES_NOT_CONTAIN",
                "ENDS_WITH",
                "EQUALS",
                "NOT_EQUALS",
                "STARTS_WITH",
            ];

            if (!validRelations.includes(normalizedRelation)) {
                throw new Error(`Unsupported ${field} relation: ${relation}`);
            }

            return {
                [conditionKey]: {
                    relation: normalizedRelation,
                    values,
                    matchType: "ANY",
                },
            };
        }

        if (field === "PRICE") {
            const amount = String(rule.amount ?? values[0] ?? "").trim();
            const currencyCode = String(rule.currencyCode ?? "").trim();

            if (!["EQUALS", "GREATER_THAN", "LESS_THAN", "NOT_EQUALS"].includes(relation)) {
                throw new Error(`Unsupported PRICE relation: ${relation}`);
            }
            if (!amount || !currencyCode) {
                throw new Error("PRICE conditions require an amount and currency code.");
            }

            return {
                variantPrice: {
                    relation,
                    value: { amount, currencyCode },
                },
            };
        }

        throw new Error(`Unsupported condition field: ${field}`);
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
            let missingProductHandles: string[] = [];
            const isManual = String(collection.type).trim().toLowerCase() === "manual"

            const productHandles = Array.isArray(collection.productHandles)
                ? collection.productHandles
                : typeof collection.productHandles === "string"
                    ? collection.productHandles.split("|")
                    : [];

            const normalizedProductHandles = productHandles
                .map((handle: string) => handle.trim())
                .filter(Boolean);

            if (isManual && normalizedProductHandles.length > 0) {

                const productQuery = normalizedProductHandles
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

                const productsErrors = getGraphQLErrors(productsResult);
                if (productsErrors) {
                    results.push({
                        handle: collection.handle,
                        status: "failed",
                        errors: productsErrors,
                    });

                    continue;
                }

                const products = productsResult.data?.products?.nodes ?? [];

                const foundHandles = new Set(
                    products.map((product: { handle: string }) => product.handle.toLowerCase())
                )

                missingProductHandles = normalizedProductHandles.filter(
                    (handle: string) => !foundHandles.has(handle.toLowerCase())
                );

                productIds = products.map(
                    (product: { id: string }) => product.id
                );

                if (missingProductHandles.length > 0) {
                    console.warn(
                        `Collection ${collection.handle} has product handles that were not found; creating it with the products that exist.`,
                        missingProductHandles,
                    );
                }
            }

            const sortOrder = String(collection.sortOrder ?? "").trim().toUpperCase();
            if (sortOrder && !VALID_SORT_ORDERS.has(sortOrder)) {
                results.push({
                    handle: collection.handle,
                    status: "failed",
                    errors: [{ message: `Unsupported sort order: ${collection.sortOrder}` }],
                });
                continue;
            }

            const collectionInput: Record<string, unknown> = {
                title: collection.title,
                handle: collection.handle,
                descriptionHtml: collection.descriptionHtml || "",
            }

            if (sortOrder) {
                collectionInput.sortOrder = sortOrder
            }

            if (collection.templateSuffix) {
                collectionInput.templateSuffix = collection.templateSuffix;
            }

            if (!isManual && Array.isArray(collection.conditions)) {
                let conditions: ReturnType<typeof buildSmartConditions>;
                try {
                    conditions = buildSmartConditions(collection.conditions);
                } catch (error) {
                    results.push({
                        handle: collection.handle,
                        status: "failed",
                        errors: [{
                            message: error instanceof Error ? error.message : String(error),
                        }],
                    });
                    continue;
                }

                collectionInput.sources = [
                    {
                        source: {
                            title: "Imported smart collection rules",
                            inclusion: {
                                matchType: String(collection.matchType).toUpperCase() === "ANY" ? "ANY" : "ALL",
                                conditions
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

            const collectionErrors = getGraphQLErrors(result);
            if (collectionErrors) {
                results.push({
                    handle: collection.handle,
                    status: "failed",
                    errors: collectionErrors,
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

                console.log(
                    "ADD PRODUCTS RESULT:",
                    JSON.stringify(addProductsResult, null, 2),
                );
                console.log("PRODUCT IDS:", productIds);

                const addProductsErrors = getGraphQLErrors(addProductsResult);
                if (addProductsErrors?.length) {
                    results.push({
                        handle: collection.handle,
                        status: "failed",
                        errors: addProductsErrors,
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
                ...(missingProductHandles.length > 0
                    ? { warnings: [`Products not found and skipped: ${missingProductHandles.join(", ")}`] }
                    : {}),
            });
        }

        return Response.json({
            success: true,
            results
        })

    } catch (error) {
        console.error("COLLECTION IMPORT ERROR:", error);

        return Response.json(
            {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            },
            { status: 500 },
        );
    }
}
