FROM node:22-alpine

# This host has no IPv6 route out of containers, and registry.npmjs.org has
# AAAA records. Node 20+ tries both families at once (Happy Eyeballs) and hangs
# until timeout instead of falling back, which npm reports as the misleading
# "Exit handler never called!". BOTH flags are required — either one alone
# still hangs. wget works from the same image, so the network looks healthy.
ENV NODE_OPTIONS="--dns-result-order=ipv4first --no-network-family-autoselection"

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY src ./src
COPY migrations ./migrations

USER node
EXPOSE 8092
CMD ["node", "src/index.js"]
