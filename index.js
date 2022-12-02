const fs = require("fs");
const _ = require("lodash");
const path = require("path");
const http = require('http');
const jsyaml = require("js-yaml");
const express = require("express");
const oasTools = require("@oas-tools/core");
const { spawnSync } = require("node:child_process");

// Get network ID
const info = JSON.parse(spawnSync("ip", ["-j", "route"]).stdout).filter(route => route.dst !== "default");
const netId = info[0].dst;


// Discover services through ICMP and ARP // TODO run periodically
console.log(`Performing network scan for ${netId}...`);
spawnSync("nmap", ["-sn", "-n", "--send-ip", netId]);

const arpcache = spawnSync("ip", ["-j", "neighbor", "show"]).stdout.toString();
const hosts = JSON.parse(arpcache).filter(host => host.state.includes("REACHABLE"));

console.log(`Found ${hosts.length} connected to the network`);


// Get each host oas-doc, build and deploy server
console.log(`Getting OAS Doc declarations from supported hosts...`)

Promise.allSettled(
    hosts.map(async host => {
        let res = await fetch(`http://${host.dst}/docs/swagger.json`);
        if(res.ok) {
            let oasDoc = await res.json();
            return [host.dst, oasDoc];
        } 
    })
).then(res => {
    console.log("Building gateway OASDoc...")
    let entries = res.filter(prom => prom.status === "fulfilled").map(prom => prom.value);
    
    return entries
    .map(([ip, oasDoc]) => {
        let paths = Object.entries(oasDoc.paths);
        paths = Object.fromEntries(paths.map(([endp, pathObj]) => {
            let ops = Object.entries(pathObj).filter(([op, _opObj]) => ["get", "post", "put", "delete", "patch", "head", "options", "trace"].includes(op));
            pathObj = Object.fromEntries(ops.map(([op, opObj]) => [op, {["x-proxy-url"]: `http://${ip}`, tags: [oasDoc.info?.title ?? "default"], ...opObj}]));
            return [endp.replace(/:.+?(?=\/|$)/g, (m) => `{${m.substring(1)}}`), pathObj]; // The replace function modifies express path to be an open api path
        }))
        oasDoc.paths = paths;
        return oasDoc;
    })
    .reduce((acc, curr) => {
        acc.paths = _.merge(acc.paths, curr.paths);
        acc.components = _.merge(acc.components, curr.components);
        if (curr.security?.length > 0) acc.security = _.merge(acc.security ?? [], curr.security);
        return acc;
    }, 
    {   // Initial doc value
        openapi: "3.0.3",
        info: { title: "YourYummy!", description: "The social network for cookers", version: "1.0.0"},
        paths: {},
        components: {}
    });
}).then(async oasDoc => {
    console.log("Initializing server") // TODO if changes detected

    // Import JWT handlers from OAS Auth
    const { bearerJwt } = await import("@oas-tools/auth/handlers");
    const { OASBearerJWT } = await import("@oas-tools/auth/middleware");

    // Create /api/oas-doc.yaml
    fs.writeFileSync(path.join(__dirname, "api", "oas-doc.yaml"), jsyaml.dump(oasDoc));

    // Configure express for oas tools server
    const oasToolsCfg = require("./oastools.config");
    const oasProxy = require("./oasproxy");
    const app = express();

    app.use(express.json({limit: '50mb'}));
    oasTools.use(oasProxy, {}, 4);
    
    // Add security handlers based on oasDoc secSchemes
    if(Object.values(oasDoc.components.securitySchemes).some(secSchemeDef => secSchemeDef.bearerFormat === "JWT")) {
        oasTools.use(OASBearerJWT, {roleBinding: process.env.JWT_ROLE_BINDING ?? "role"}, 2);
        Object.entries(oasDoc.components.securitySchemes).forEach(([secScheme, secSchemeDef]) => {
            if (secSchemeDef.scheme === "bearer" && secSchemeDef.bearerFormat === "JWT")
                oasToolsCfg.middleware.security.auth[secScheme] = bearerJwt({issuer: process.env.JWT_ISSUER, secret: process.env.JWT_SECRET});
        })
    }
    
    // Initialize oas tools
    oasTools.initialize(app, oasToolsCfg).then(() => {
        http.createServer(app).listen(8080, () => {
            console.log("Server is up")
        })
    })

}).catch(err => {
    console.error(err);
});
