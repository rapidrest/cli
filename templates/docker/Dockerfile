FROM node:lts-trixie-slim AS builder

# Set the working directory to /app
WORKDIR /app

# Copy the current directory contents into the container at /app
COPY . ./

ARG NODE_ENV=production
ENV NODE_ENV=${NODE_ENV}
ENV MONGOMS_DISABLE_POSTINSTALL=1
ENV REDISMS_DISABLE_POSTINSTALL=true
RUN echo Building as $NODE_ENV
# Install any needed packages specified in requirements.txt
RUN apt update && apt upgrade -y
{{#if pkgMgr.yarn}}
RUN corepack enable
RUN yarn install --immutable
RUN yarn build
{{else}}
RUN npm ci
RUN npm run build
{{/if}}

FROM node:lts-trixie-slim AS runner
WORKDIR /app
# Own the app's own files as the pre-existing, non-root `node` user (built into this base image) rather
# than running as root - USER below switches to it once every root-only step (package installs, chmod)
# is done.
{{#if pkgMgr.yarn}}
COPY --from=builder --chown=node:node /app/package.json /app/yarn.lock /app/.yarnrc.yml /app/tsconfig.json /app/RELEASE_NOTES.md ./
COPY --from=builder --chown=node:node /app/.yarn/releases ./.yarn/releases
{{else}}
COPY --from=builder --chown=node:node /app/package.json /app/package-lock.json /app/tsconfig.json /app/RELEASE_NOTES.md ./
{{/if}}
{{#if hasReact}}
COPY --from=builder --chown=node:node /app/app ./app
COPY --from=builder --chown=node:node /app/public ./public
{{/if}}
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/src ./src
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/scripts ./scripts
RUN chmod +x /app/scripts/*.sh
# Add curl for health check
RUN apt update && apt upgrade -f -y && apt install curl -y
RUN npm install --global nodemon
{{#if pkgMgr.yarn}}
RUN corepack enable
{{/if}}

ARG NODE_ENV=production
ENV NODE_ENV=${NODE_ENV}
RUN echo Running as $NODE_ENV

# Make port 3000 available to the world outside this container
EXPOSE 3000
# Make port 9229 available to the world for debugging
EXPOSE 9229

# Define environment variable
ENV PORT=3000

# Run as the non-root `node` user (see the COPY --chown above) rather than the default root - limits the
# blast radius of a container-breakout or arbitrary-file-write vulnerability. Everything above this line
# needs root (installing packages, chmod); nothing below it does.
USER node

# Set a healthcheck to ensure the service is always alive. Deliberately not `curl -f`: `-f` treats any
# non-2xx response as a failed check, but `/` 404s (a normal, healthy response - it just means no React
# app claimed the root route) for any project generated without --react. A plain, unhandled-route 404
# still proves the server process is up and routing requests; only a connection failure (refused,
# timeout) - which curl treats as a failure regardless of `-f` - should count as unhealthy here.
HEALTHCHECK --interval=10s --timeout=60s --start-period=15s --retries=3 CMD curl -s -o /dev/null http://localhost:3000/ || exit 1

# Run app.js when the container launches
{{#if pkgMgr.yarn}}
CMD ["yarn", "rapidrest", "start", "--docker", "--no-build"]
{{else}}
CMD ["npm", "rapidrest", "start", "--docker", "--no-build"]
{{/if}}
