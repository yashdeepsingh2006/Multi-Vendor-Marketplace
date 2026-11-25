import { Router, raw } from "express";
import { razorpayWebhookController } from "../controllers/customer-order.controller.js";

const router = Router();

// Razorpay signs the exact request bytes, so this route must receive the raw body
// before the application-wide JSON parser runs. It is mounted in src/index.js
// ahead of express.json().
router.post(
    "/razorpay/webhook",
    raw({ type: "*/*", limit: "1mb" }),
    razorpayWebhookController
);

export { router as paymentRouter };
export default router;
