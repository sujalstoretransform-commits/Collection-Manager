import { HeadersFunction, LoaderFunctionArgs, useRevalidator } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useState } from "react";
import { useLoaderData } from "react-router";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

  const response = await admin.graphql(
    `#graphql
        query Collections($first: Int!, $after: String) {
            collections(first: $first, after: $after) {
                nodes {
                    id
                    title
                    handle
                    descriptionHtml
                    sortOrder
                    templateSuffix
                    productsCount(first: 250) {
                        count
                    }
                }
                pageInfo {
                    hasNextPage
                    endCursor 
                }
            }
        }
    `,
    {
      variables: {
        first: 50,
        after: null,
      },
    }
  )

  const result = await response.json()

  return result.data.collections.nodes;
};

const parseCsv = (text: string) => {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let insideQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"' && insideQuotes && nextChar === '"') {
      value += '"';
      i++;
      continue;
    }

    if (char === '"') {
      insideQuotes = !insideQuotes;
      continue;
    }

    if (char === "," && !insideQuotes) {
      row.push(value);
      value = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !insideQuotes) {
      if (char === "\r" && nextChar === "\n") {
        i++;
      }

      row.push(value);
      rows.push(row);
      row = [];
      value = "";
      continue;
    }

    value += char;
  }

  if (value !== "" || row.length > 0) {
    row.push(value);
    rows.push(row);
  }

  if (rows.length < 2) {
    throw new Error(
      "CSV must contain a header and at least one collection.",
    );
  }

  const headers = rows[0].map((header) => header.trim());

  const requiredHeaders = [
    "handle",
    "title",
    "descriptionHtml",
    "sortOrder",
    "templateSuffix",
    "type",
    "matchType",
    "conditions",
    "productHandles",
  ];

  for (const header of requiredHeaders) {
    if (!headers.includes(header)) {
      throw new Error(`Missing CSV column: ${header}`);
    }
  }

  return rows.slice(1).map((values) => {
    const collection: Record<string, string> = {};

    headers.forEach((header, index) => {
      collection[header] = values[index]?.trim() ?? "";
    });

    return collection;
  });
}

const validateConditions = (collection: any) => {
  if (collection.type?.trim().toLowerCase() !== "smart") {
    return null;
  }

  if (!collection.conditions) {
    return {
      status: "Error",
      reason: "Smart collection requires conditions",
    };
  }

  let conditions: any[]

  if (Array.isArray(collection.conditions)) {
    conditions = collection.conditions;
  }

  else if (typeof collection.conditions === "string") {
    if (collection.conditions.trim() === "") {
      return {
        status: "Error",
        reason: "Smart collection requires conditions",
      };
    }

    conditions = collection.conditions
      .split(";")
      .map((condition: string) => {
        const values: Record<string, string> = {};

        condition.split("|").forEach((part: string) => {
          const [key, ...rest] = part.split("=");

          if (key && rest.length > 0) {
            values[key.trim()] = rest.join("=").trim();
          }
        });

        return {
          field: values.field,
          relation: values.relation,
          matchType: values.matchType,
          values: values.values
            ? values.values.split("^").map((value) => value.trim())
            : [],
          amount: values.amount,
          currencyCode: values.currencyCode,
        };
      });
  }

  else {
    return {
      status: "Error",
      reason: "Invalid conditions format",
    };
  }

  if (conditions.length === 0) {
    return {
      status: "Error",
      reason: "Smart collection requires at least one condition",
    };
  }

  const validFields = ["tag", "title", "type", "vendor", "price"];

  for (const condition of conditions) {
    if (!validFields.includes(String(condition.field).toLowerCase())) {
      return {
        status: "Error",
        reason: `Front Unsupported condition field: ${condition.field}`,
      };
    }

    if (!condition.relation) {
      return {
        status: "Error",
        reason: "Condition relation is required",
      };
    }

    if (condition.field === "price") {
      if (!condition.amount) {
        return {
          status: "Error",
          reason: "Price condition requires amount",
        };
      }

      if (!/^\d+(\.\d{1,2})?$/.test(condition.amount)) {
        return {
          status: "Error",
          reason: "Invalid price amount",
        };
      }

      if (!condition.currencyCode) {
        return {
          status: "Error",
          reason: "Price condition requires currencyCode",
        };
      }
    }
    else {
      if (
        !Array.isArray(condition.values) ||
        condition.values.length === 0
      ) {
        return {
          status: "Error",
          reason: "Condition values are required",
        };
      }
    }
  }

  return null;
}

const validateCollection = (collection: any, allCollections: any[]) => {
  if (collection.alreadyExists) {
    return {
      status: "Skipped",
      reason: "Collection already exists"
    }
  }

  if (!collection.handle?.trim()) {
    return {
      status: "Error",
      reason: "Handle is required",
    };
  }

  if (!collection.title?.trim()) {
    return {
      status: "Error",
      reason: "Title is required",
    };
  }

  if (!["smart", "manual"].includes(collection.type)) {
    return {
      status: "Error",
      reason: "Type must be smart or manual",
    };
  }

  if (!validSortOrders.includes(collection.sortOrder?.trim())) {
    return {
      status: "Error",
      reason: "Invalid sort order",
    };
  }

  if (collection.type?.trim().toLowerCase() === "smart" && !validMatchTypes.includes(collection.matchType?.trim().toUpperCase())) {
    return {
      status: "Error",
      reason: "Smart collections require matchType ALL or ANY",
    };
  }

  const conditionError = validateConditions(collection)
  if (conditionError) {
    return conditionError
  }

  if (collection.type?.trim().toLowerCase() === "manual") {
    if (Array.isArray(collection.productHandles)) {
      if (collection.productHandles.length === 0) {
        return {
          status: "Error",
          reason: "Manual collection requires product handles",
        };
      }
    }
    else if (
      Array.isArray(collection.missingProductHandles) &&
      collection.missingProductHandles.length > 0
    ) {
      return {
        status: "Error",
        reason: `Missing products: ${collection.missingProductHandles.join(", ")}`,
      };
    }
    else if (typeof collection.productHandles === "string") {
      if (collection.productHandles.trim() === "") {
        return {
          status: "Error",
          reason: "Manual collection requires product handles",
        };
      }
    }
    else {
      return {
        status: "Error",
        reason: "Invalid productHandles format",
      };
    }
  }

  const duplicateCount = allCollections.filter(
    (item) => item.handle?.trim().toLowerCase() === collection.handle?.trim().toLowerCase()
  ).length

  if (duplicateCount > 1) {
    return {
      status: "Error",
      reason: "Duplicate handle in import file",
    };
  }

  return {
    status: "Ready",
    reason: "-",
  };
}

const validSortOrders = [
  "ALPHA_ASC",
  "ALPHA_DESC",
  "BEST_SELLING",
  "CREATED",
  "PRICE_ASC",
  "PRICE_DESC",
  "MANUAL",
  "MOST_RELEVANT",
];

const validMatchTypes = ["ALL", "ANY"];

const downloadFile = (
  content: string,
  filename: string,
  type: string,
) => {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob)

  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();

  URL.revokeObjectURL(url);
}

const csvEscape = (value: unknown) => {
  const text = value == null ? "" : String(value);

  return `"${text.replace(/"/g, '""')}"`;
}

const buildCsv = (data: any) => {
  const headers = [
    "handle",
    "title",
    "descriptionHtml",
    "sortOrder",
    "templateSuffix",
    "type",
    "matchType",
    "conditions",
    "productHandles",
  ];

  const rows = data.collections.map((collection: any) => {
    const conditions = (collection.conditions ?? [])
      .map((condition: any) => {
        if (condition.field === "price") {
          return [
            `field=${condition.field}`,
            `relation=${condition.relation}`,
            `amount=${condition.amount}`,
            `currencyCode=${condition.currencyCode}`,
          ].join("|");
        }
        return [
          `field=${condition.field}`,
          `relation=${condition.relation}`,
          `values=${(condition.values ?? []).join("^")}`,
        ].join("|");
      })
      .join(";");
    return [
      collection.handle,
      collection.title,
      collection.descriptionHtml,
      collection.sortOrder,
      collection.templateSuffix,
      collection.type,
      collection.matchType ?? "",
      conditions,
      (collection.productHandles ?? []).join("|"),
    ]
      .map(csvEscape)
      .join(",");
  });
  return [
    headers.map(csvEscape).join(","),
    ...rows,
  ].join("\r\n");
}

const buildSampleCsv = () => {
  const headers = [
    "handle",
    "title",
    "descriptionHtml",
    "sortOrder",
    "templateSuffix",
    "type",
    "matchType",
    "conditions",
    "productHandles",
  ];

  const rows = sampleImportData.collections.map((collection) => {
    const conditions = collection.conditions
      .map((condition: any) => {
        return [
          `field=${condition.field}`,
          `relation=${condition.relation}`,
          `matchType=${condition.matchType}`,
          `values=${condition.values.join("^")}`,
        ].join("|");
      })
      .join(";");

    return [
      collection.handle,
      collection.title,
      collection.descriptionHtml,
      collection.sortOrder,
      collection.templateSuffix ?? "",
      collection.type,
      collection.matchType ?? "",
      conditions,
      collection.productHandles.join("|"),
    ]
      .map(csvEscape)
      .join(",");
  });

  return [
    headers.map(csvEscape).join(","),
    ...rows,
  ].join("\r\n");
}

const sampleImportData = {
  version: 1,
  exportedAt: new Date().toISOString(),
  collections: [
    {
      handle: "sample-smart-collection",
      title: "Sample Smart Collection",
      descriptionHtml: "<p>Example smart collection</p>",
      sortOrder: "BEST_SELLING",
      templateSuffix: null,
      type: "smart",
      matchType: "ANY",
      conditions: [
        {
          field: "tag",
          relation: "TAGGED_WITH",
          values: ["summer", "sale"],
          matchType: "ANY",
        },
      ],
      productHandles: [],
    },
    {
      handle: "sample-manual-collection",
      title: "Sample Manual Collection",
      descriptionHtml: "<p>Example manual collection</p>",
      sortOrder: "MANUAL",
      templateSuffix: null,
      type: "manual",
      matchType: null,
      conditions: [],
      productHandles: [
        "sample-product-1",
        "sample-product-2",
      ],
    },
  ],
};

export default function Index() {

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [format, setFormat] = useState<"csv" | "json">("csv");
  const [file, setFile] = useState<globalThis.File | null>(null)
  const [fileError, setFileError] = useState<string | null>(null);
  const [importData, setImportData] = useState<any[]>([]);
  const collections = useLoaderData<typeof loader>()
  const revalidator = useRevalidator();

  const allSelected = selectedIds.length === collections.length;

  const validationResults = importData.map((collection, index) => {
    const validation = validateCollection(collection, importData)

    return {
      id: `${index}`,
      collection: collection.title || collection.handle,
      status: validation.status,
      reason: validation.reason
    }
  })

  const toggleCollection = (id: string) => {
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter((selectedId) => selectedId !== id));
    } else {
      setSelectedIds([...selectedIds, id]);
    }
  }

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds([]);
    } else {
      setSelectedIds(collections.map((collection: any) => collection.id));
    }
  }

  const clearSelected = () => {
    setSelectedIds([]);
  }

  const checkFileFun = async () => {
    if (!file) return;

    try {
      setFileError(null);
      setImportData([]);

      const text = await file.text();

      let collections: any[];

      if (file.name.toLowerCase().endsWith(".json")) {
        const parsed = JSON.parse(text);

        if (!Array.isArray(parsed.collections)) {
          throw new Error("Invalid JSON format. Expected an array of collections.");
        }

        collections = parsed.collections;
      }
      else {
        collections = parseCsv(text)
      }

      const response = await fetch("/api/collections/existing", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        }
      })

      const existingResult = await response.json()

      if (!response.ok) {
        throw new Error(
          existingResult.error ||
          "Failed to check existing collections."
        );
      }

      const existingHandles = new Set(
        existingResult.handles.map((handle: string) =>
          handle.toLowerCase()
        )
      );

      const manualCollections = collections.filter(
        (collection: any) =>
          String(collection.type).toLowerCase() === "manual"
      );

      const allProductHandles = Array.from(
        new Set(
          manualCollections.flatMap((collection: any) => {
            if (Array.isArray(collection.productHandles)) {
              return collection.productHandles
                .map((handle: string) => handle.trim())
                .filter(Boolean);
            }

            if (typeof collection.productHandles === "string") {
              return collection.productHandles
                .split("|")
                .map((handle: string) => handle.trim())
                .filter(Boolean);
            }

            return [];
          })
        )
      );

      let existingProductHandles = new Set<string>();

      const productResponse = await fetch("/api/products/existing", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          handles: allProductHandles,
        }),
      })

      const productResult = await productResponse.json();

      if (!productResponse.ok) {
        throw new Error(
          productResult.error ||
          "Failed to check existing products."
        );
      }

      existingProductHandles = new Set(
        (productResult.handles ?? []).map((handle: string) =>
          handle.toLowerCase()
        )
      );

      const checkedCollections = collections.map((collection) => {
        const handle =
          typeof collection.handle === "string"
            ? collection.handle.trim().toLowerCase()
            : "";

        let missingProductHandles: string[] = [];

        if (
          String(collection.type ?? "").toLowerCase() === "manual"
        ) {
          const productHandles = Array.isArray(
            collection.productHandles
          )
            ? collection.productHandles
              .map((handle: string) => handle.trim())
              .filter(Boolean)
            : typeof collection.productHandles === "string"
              ? collection.productHandles
                .split("|")
                .map((handle: string) => handle.trim())
                .filter(Boolean)
              : [];

          missingProductHandles = productHandles.filter(
            (productHandle: string) =>
              !existingProductHandles.has(
                productHandle.toLowerCase()
              )
          );
        }

        return {
          ...collection,
          alreadyExists: existingHandles.has(handle),
          missingProductHandles,
        };
      });

      setImportData(checkedCollections);

    } catch (error) {
      setImportData([]);
      setFileError(error instanceof Error ? error.message : "Invalid file.");
    }
  }

  const importCollections = async () => {
    const readyCollections = importData.filter((collection: any) => {
      const result = validateCollection(collection, importData)
      return result.status === "Ready"
    })
      .map((collection: any) => {
        if (
          typeof collection.conditions !== "string" ||
          collection.type?.toLowerCase() !== "smart"
        ) {
          return collection;
        }

        const conditions = collection.conditions
          .split(";")
          .filter(Boolean)
          .map((condition: string) => {
            const parsed: Record<string, string> = {};

            condition.split("|").forEach((part) => {
              const [key, ...rest] = part.split("=");

              if (key && rest.length > 0) {
                parsed[key.trim()] = rest.join("=").trim();
              }
            });

            return {
              field: parsed.field,
              relation: parsed.relation,
              matchType: parsed.matchType,
              values: parsed.values
                ? parsed.values.split("^").map((value) => value.trim()).filter(Boolean)
                : [],
              amount: parsed.amount,
              currencyCode: parsed.currencyCode,
            };
          })

        return {
          ...collection,
          conditions,
        };
      })

    if (readyCollections.length === 0){
      return;
    }

    try {
      setFileError(null)

      const response = await fetch("/api/collections/import", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          collections: readyCollections,
        })
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(
          result.error || "Failed to import collections."
        );
      }

      console.log("Import result:", result);
      revalidator.revalidate()

    } catch (error) {
      setFileError(
        error instanceof Error
          ? error.message
          : "Failed to import collections."
      );
    }
  }

  const downloadExport = async () => {
    if (selectedIds.length === 0) return;

    const response = await fetch("/api/collections/export", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ids: selectedIds,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      alert(error.error ?? "Export failed.");
      return;
    }

    const data = await response.json();

    if (format === "json") {
      downloadFile(
        JSON.stringify(data, null, 2),
        "collections-export.json",
        "application/json",
      )
    }
    else {
      downloadFile(
        buildCsv(data),
        "collections-export.csv",
        "text/csv;charset=utf-8",
      )
    }
  }

  const readyImportCount = validationResults.filter((result) => result.status === "Ready").length;

  return (
    <s-page heading="Collection Export & Import">
      <s-section heading="Export Collections">
        <s-stack gap="small-100 large-100">
          <s-stack direction="inline" gap="large" align-items="center">
            <s-text>
              {selectedIds.length} collections selected
            </s-text>
            <s-button
              variant="primary"
              disabled={selectedIds.length === 0}
              onClick={downloadExport}
            >
              Download export file
            </s-button>
            <s-select
              label="Export Format"
              value={format}
              onChange={(e: Event) => {
                const target = e.target as HTMLSelectElement;
                setFormat(target.value as "csv" | "json");
              }}
            >
              <s-option value="csv">CSV</s-option>
              <s-option value="json">JSON</s-option>
            </s-select>
          </s-stack>
          <s-stack direction="inline" gap="small-100 large-100" alignItems="center">
            <s-button
              onClick={toggleSelectAll}
            >
              {allSelected ? "Clear All" : "Select All"}
            </s-button>
            <s-button
              onClick={clearSelected}
              disabled={selectedIds.length === 0}
            >
              Clear Selected
            </s-button>
          </s-stack>
          <s-table>
            <s-table-header-row>
              <s-table-header>Select</s-table-header>
              <s-table-header>Title</s-table-header>
              <s-table-header>Handle</s-table-header>
              <s-table-header>Type</s-table-header>
              <s-table-header>Products</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {collections.map((collection: any) => (
                <s-table-row key={collection.id}>
                  <s-table-cell>
                    <s-checkbox
                      checked={selectedIds.includes(collection.id)}
                      onChange={() => toggleCollection(collection.id)}
                      label={collection.title}
                    />
                  </s-table-cell>
                  <s-table-cell>{collection.title}</s-table-cell>
                  <s-table-cell>{collection.handle}</s-table-cell>
                  <s-table-cell>{collection.type}</s-table-cell>
                  <s-table-cell>{collection.productsCount.count}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-stack>
      </s-section>
      <s-section heading="Import Collections">
        <s-stack gap="small-100 large-100">
          <s-text>Import collections from a CSV or JSON file.</s-text>
          <s-stack direction="inline" gap="large" alignItems="center">
            <s-button
              onClick={() => {
                downloadFile(
                  buildSampleCsv(),
                  "collections-import-sample.csv",
                  "text/csv;charset=utf-8",
                )
              }}
            >
              Download Sample CSV</s-button>
            <s-button
              onClick={() => {
                downloadFile(
                  JSON.stringify(sampleImportData, null, 2),
                  "collections-import-sample.json",
                  "application/json",
                )
              }}
            >
              Download Sample JSON</s-button>
          </s-stack>
          <s-section>
            <s-stack gap="small-100 large-100">
              <s-text>Select a CSV or JSON file to import.</s-text>
              <s-stack direction="inline" gap="small-100 large-100" alignItems="center">
                <input
                  type="file"
                  id="import-file"
                  accept=".csv,.json"
                  hidden
                  onChange={(e) => {
                    setFile(e.target.files?.[0] ?? null);
                  }}
                />
                <s-button
                  onClick={() => document.getElementById("import-file")?.click()}
                >
                  Choose File
                </s-button>
                <s-text> {file ? file.name : "No file selected"} </s-text>
              </s-stack>
            </s-stack>
          </s-section>
          <s-button
            variant="primary"
            disabled={!file}
            onClick={checkFileFun}
          >
            Check File
          </s-button>
          <s-text>
            {
              fileError && (
                <s-text tone="critical">{fileError}</s-text>
              )
            }
          </s-text>
          <s-section heading="Validation Results">
            <s-stack gap="small-100 large-100">
              <s-table>
                <s-table-header-row>
                  <s-table-header>Collection</s-table-header>
                  <s-table-header>Status</s-table-header>
                  <s-table-header>Reason</s-table-header>
                </s-table-header-row>

                <s-table-body>
                  {validationResults.map((result) => (
                    <s-table-row key={result.id}>
                      <s-table-cell>{result.collection}</s-table-cell>
                      <s-table-cell>{result.status}</s-table-cell>
                      <s-table-cell>{result.reason}</s-table-cell>
                    </s-table-row>
                  ))}
                </s-table-body>
              </s-table>

              <s-button
                variant="primary"
                disabled={readyImportCount === 0}
                onClick={importCollections}
              >
                Import {readyImportCount} Collections
              </s-button>
            </s-stack>
          </s-section>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
