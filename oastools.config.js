module.exports = {
    oasFile: "./api/oas-doc.yaml",
    logger: {
        level: "debug"
    },
    middleware: {
        router: { disable: true },
        validator: { strict: true },
        error: {disable: false, printStackTrace: false, customHandler: null}
    }
}