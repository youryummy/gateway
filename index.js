const fs = require("fs");
const _ = require("lodash");
const path = require("path");
const http = require('http');
const util = require("node:util");
const jsyaml = require("js-yaml");
const express = require("express");
const { spawnSync } = require("node:child_process");
const exec = util.promisify(require('node:child_process').exec);

// Get network ID
const info = JSON.parse(spawnSync("ip", ["-j", "route"]).stdout).filter(route => route.dst !== "default");
const netId = info[0].dst;

// Scan network and update oas tools routes
async function updateRoutes() {
    
    // Discover services through ICMP and ARP 
    console.log(`Performing network scan for ${netId}...`);
    exec(`nmap -sn -n --send-ip ${netId}`).then(() => {
        exec("ip -j neighbor show").then(({stdout, _stderr}) => {
            const hosts = JSON.parse(stdout.toString()).filter(host => host.state.includes("REACHABLE"));
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
                        pathObj = Object.fromEntries(ops.map(([op, opObj]) => [op, {...opObj, ["x-proxy-url"]: `http://${ip}`, tags: [oasDoc.info?.title ?? "default"]}]));
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
                const oasFilePath = path.join(__dirname, "api", "oas-doc.yaml");
        
                let existence = fs.existsSync(oasFilePath);
                let oldFile = existence ? jsyaml.load(fs.readFileSync(oasFilePath)) : {};
        
                // If changes detected then update routes
                if (!_.isEqual(oldFile, oasDoc)) {
                    console.log("Updating server routes...");
                    router = express.Router();
        
                    // Import OAS Tools and handlers from OAS Auth and SLA Rate Limit
                    const { initialize, use, middlewareChain } = await import("./utils/oasToolsInit.mjs");
                    const { bearerJwt } = await import("@oas-tools/auth/handlers");
                    const { OASBearerJWT } = await import("@oas-tools/auth/middleware");
                    const { SLARateLimit } = await import("@oas-tools/sla-rate-limit");
                    
                    // Reset middleware chain
                    if (!existence) {
                        originalChain = [...middlewareChain];
                    } else {
                        middlewareChain.splice(0, middlewareChain.length);
                        middlewareChain.push(...originalChain);
                    }
        
                    // Create /api/oas-doc.yaml
                    fs.writeFileSync(oasFilePath, jsyaml.dump(oasDoc));
                
                    // Configure express for oas tools server
                    const oasToolsCfg = require("./oastools.config");
                    const oasProxy = require("./oasproxy");
        
                    router.use(express.json({limit: '50mb'}));
                    use(SLARateLimit, {scheme: process.env.SLA_SEC_SCHEME ?? "apikey", slaFile: "api/sla.yaml"}, 2);
                    use(oasProxy, {}, 5);
                    
                    // Disable security if no secSchemes are defined
                    if(Object.values(oasDoc.components.securitySchemes ?? {}).length === 0) {
                        oasToolsCfg.middleware.security.disable = true;
                    }
        
                    // Add security handlers based on oasDoc secSchemes
                    if(Object.values(oasDoc.components.securitySchemes ?? {}).some(secSchemeDef => secSchemeDef.bearerFormat === "JWT")) {
                        use(OASBearerJWT, {roleBinding: process.env.JWT_ROLE_BINDING ?? "role"}, 2);
                        Object.entries(oasDoc.components.securitySchemes).forEach(([secScheme, secSchemeDef]) => {
                            if (secSchemeDef.scheme === "bearer" && secSchemeDef.bearerFormat === "JWT")
                                oasToolsCfg.middleware.security.auth[secScheme] = bearerJwt({issuer: process.env.JWT_ISSUER, secret: process.env.JWT_SECRET});
                        })
                    }
                    
                    // Initialize oas tools
                    initialize(router, oasToolsCfg).then(() => {
                        console.log("Updated server routes");
                    })
                
                } else {
                    console.log("No changes detected in network")
                }
            }).catch(err => {
                console.error(err);
            });
        })
    });
}

// Backup original middleware chain
let originalChain;

// Initialize express server
let router = express.Router();
router.all("/*", (_req, res, _next) => res.status(502).end());

const app = express();
app.use((req, res, next) => router(req, res, next));

http.createServer(app).listen(8080, () => {
    console.log("Server is up");

    // Update routes periodically (2 min)
    updateRoutes().then(() => setInterval(updateRoutes, 120000));
});

