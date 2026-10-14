export type GraphQLErrorItem = {
  message: string;
  [key: string]: unknown;
};

function isGraphQLErrorItem(error: unknown): error is GraphQLErrorItem {
  return (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  );
}

export function getGraphQLErrors(
  body: unknown,
): GraphQLErrorItem[] | undefined {
  if (typeof body !== "object" || body === null || !("errors" in body)) {
    return undefined;
  }

  const errors: unknown = body.errors;
  if (!Array.isArray(errors)) {
    return undefined;
  }

  const graphQLErrors: GraphQLErrorItem[] = [];
  for (const error of errors as unknown[]) {
    if (!isGraphQLErrorItem(error)) {
      return undefined;
    }
    graphQLErrors.push(error);
  }

  return graphQLErrors;
}
