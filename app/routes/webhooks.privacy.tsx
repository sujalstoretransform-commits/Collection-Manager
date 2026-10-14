import { type ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server"
import db from '../db.server'

export const action = async ({ request }: ActionFunctionArgs) => {
    const { shop, topic } = await authenticate.webhook(request)

    switch (topic) {
        case "CUSTOMERS_DATA_REQUEST":
        case "CUSTOMERS_REDACT":
            break;

        case "SHOP_REDACT":
            await db.session.deleteMany({ where: { shop } })
            break;
    }
    return new Response(null, { status: 200 })
}