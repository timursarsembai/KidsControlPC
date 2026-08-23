# Panel image for the self-hosted deployment. Build context is the repository
# root: the panel imports @kidscontrol/shared as a workspace, so shared/ has to
# be present for the install to resolve it.

FROM node:22-alpine AS build

# No IPv6 route out of containers on this host, and registry.npmjs.org has AAAA
# records — Node tries both families and hangs until timeout. Both flags are
# needed; npm reports the failure as "Exit handler never called!".
ENV NODE_OPTIONS="--dns-result-order=ipv4first --no-network-family-autoselection"
# electron is a root devDependency this image has no use for; downloading its
# ~200 MB binary would be the slowest part of the build.
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1

WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY web/package.json ./web/
RUN npm ci --no-audit --no-fund

COPY shared ./shared
COPY web ./web
RUN npm run build:selfhosted --workspace=web

FROM nginx:1.27-alpine
COPY --from=build /app/web/dist /usr/share/nginx/html
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
