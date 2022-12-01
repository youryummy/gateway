const fs = require("fs");
const _ = require("lodash");
const path = require("path");
const http = require('http');
const jsyaml = require("js-yaml");
const express = require("express");
const oasTools = require("@oas-tools/core");
const {spawnSync} = require("node:child_process");

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
            return [endp, pathObj];
        }))
        oasDoc.paths = paths;
        return oasDoc;
    })
    .reduce((acc, curr) => {
        acc.paths = _.merge(acc.paths, curr.paths);
        acc.components = _.merge(acc.components, curr.components);
        return acc;
    }, 
    {   // Initial doc value
        openapi: "3.0.3",
        info: { title: "YourYummy!", description: "The social network for cookers", version: "1.0.0"},
        paths: {},
        components: {schemas: {}, securitySchemes: {}}
    });
}).then(oasDoc => {
    console.log("Initializing server") // TODO if changes detected

    // Create /api/oas-doc.yaml
    fs.writeFileSync(path.join(__dirname, "api", "oas-doc.yaml"), jsyaml.dump(oasDoc));

    // Initialize oas tools server
    const oasToolsCfg = require("./oastools.config");
    const oasProxy = require("./oasproxy");
    const app = express();

    app.use(express.json({limit: '50mb'}));
    oasTools.use(oasProxy, {}, 4);
    
    oasTools.initialize(app, oasToolsCfg).then(() => {
        http.createServer(app).listen(8080, () => {
            console.log("Server is up")
        })
    })

}).catch(err => {
    console.error(err);
});
