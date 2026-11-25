import express from "express";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

import routes from "../routes/index.js";
import paymentRouter from "../routes/payment.routes.js";

const app = express();

const configuredOrigin = process.env.CORS_ORIGIN;
const originSetting = !configuredOrigin || configuredOrigin === "*" || configuredOrigin === "true"
    ? true
    : (configuredOrigin.includes(",") ? configuredOrigin.split(",").map(o => o.trim()) : configuredOrigin);

const corsOptions = {
    origin: originSetting,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
    credentials: true,
    optionsSuccessStatus: 200
};

app.use(cors(corsOptions));

// Razorpay webhooks must receive the unparsed request body for signature
// verification, so mount this router before express.json().
app.use("/payments", paymentRouter);
app.use(express.json());

app.get("/health", (req, res) => {
    res.json({ message: "ok", service: "order-service" });
});

// Mount order routes
app.use(routes);

const PORT = process.env.PORT || 3003;
app.listen(PORT, () => {
    console.log(`Order service started on port ${PORT}`);
});

export default app;

