import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  // Shopify sends shops through the embedded app route, where the official
  // authentication flow runs. Keep this redirect and avoid asking merchants
  // to enter their shop domain manually.
  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return null;
};

export default function App() {
  return (
    <main className={styles.index}>
      <div className={styles.content}>
        <p className={styles.eyebrow}>Collection Manager</p>
        <h1 className={styles.heading}>Move collection data with confidence</h1>
        <p className={styles.text}>
          Export your Shopify collections to JSON or CSV, review the file, and
          import collections into another store.
        </p>
        <ul className={styles.list}>
          <li>
            <strong>Export collections</strong>
            <span>Download collection details in JSON or CSV format.</span>
          </li>
          <li>
            <strong>Preview before import</strong>
            <span>Review collection data and validation results first.</span>
          </li>
          <li>
            <strong>Import collection rules</strong>
            <span>Bring in manual collections and supported smart collection conditions.</span>
          </li>
        </ul>
        <p className={styles.note}>
          Install the app from Shopify to open Collection Manager inside your
          admin.
        </p>
      </div>
    </main>
  );
}
