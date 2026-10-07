import type { HeadersFunction, LoaderFunctionArgs, } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useState } from "react";

const mockCollections = [
  {
    id: "1",
    title: "Summer Collection",
    handle: "summer-collection",
    type: "smart",
    count: 24,
  },
  {
    id: "2",
    title: "Shoes",
    handle: "shoes",
    type: "manual",
    count: 12,
  },
  {
    id: "3",
    title: "Sale",
    handle: "sale",
    type: "smart",
    count: 8,
  },
  {
    id: "4",
    title: "New Arrivals",
    handle: "new-arrivals",
    type: "manual",
    count: 16,
  },
];

const validationResults = [
  {
    id: "1",
    collection: "Summer Collection",
    status: "Ready",
    reason: "-",
  },
  {
    id: "2",
    collection: "Sale Collection",
    status: "Ready",
    reason: "-",
  },
  {
    id: "3",
    collection: "Old Products",
    status: "Skipped",
    reason: "Collection already exists",
  },
  {
    id: "4",
    collection: "Invalid Collection",
    status: "Error",
    reason: "Invalid sort order",
  },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  return null;
};

export default function Index() {

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [format, setFormat] = useState<"csv" | "json">("csv");

  const allSelected = selectedIds.length === mockCollections.length;

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
      setSelectedIds(mockCollections.map((collection) => collection.id));
    }
  }

  const clearSelected = () => {
    setSelectedIds([]);
  }

  const readyImportCount = validationResults.filter((result) => result.status === "Ready").length;

  return (
    <s-page heading="Collection Export & Import">
      <s-section heading="Export Collections">
        <s-stack direction="inline" gap="large" align-items="center">
          <s-text>
            {selectedIds.length} collections selected
          </s-text>
          <s-button
            variant="primary"
            disabled={selectedIds.length === 0}
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
        <s-stack direction="inline" gap="base">
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
            {mockCollections.map((collection) => (
              <s-table-row key={collection.id}>
                <s-table-cell>
                  <s-checkbox
                    checked={selectedIds.includes(collection.id)}
                    onChange={() => toggleCollection(collection.id)}
                    label={`Select ${collection.title}`}
                  />
                </s-table-cell>
                <s-table-cell>{collection.title}</s-table-cell>
                <s-table-cell>{collection.handle}</s-table-cell>
                <s-table-cell>{collection.type}</s-table-cell>
                <s-table-cell>{collection.count}</s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>
      <s-section heading="Import Collections">
        <s-stack gap="small-100 large-100">
          <s-text>Import collections from a CSV or JSON file.</s-text>
          <s-stack direction="inline" gap="large" alignItems="center">
            <s-button>Download Sample CSV</s-button>
            <s-button>Download Sample JSON</s-button>
          </s-stack>
          <s-section>
            <s-stack gap="base">
              <s-text>Select a CSV or JSON file to import.</s-text>
              <s-stack direction="inline" gap="base" alignItems="center">
                <s-button>Choose File </s-button>
                <s-text> No file selected</s-text>
              </s-stack>
            </s-stack>
          </s-section>
          <s-button variant="primary" disabled>Check File</s-button>
          <s-section heading="Validation Results">
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

            <s-button variant="primary">
              Import {readyImportCount} Collections
            </s-button>
          </s-section>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
