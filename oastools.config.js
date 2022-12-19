module.exports = {
    oasFile: "./api/oas-doc.yaml",
    logger: {
        level: "info"
    },
    middleware: {
        router: { disable: true },
        validator: { strict: true },
        error: {
            disable: false, 
            printStackTrace: process.env.NODE_ENV !== "production",
            customHandler: (err, send) => {
                if(err.name === "JsonWebTokenError") send(403);
            }
        },
        security: { disable: false, auth: {} }
    }
}