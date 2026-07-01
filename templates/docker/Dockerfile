# Use an official Python runtime as a parent image
FROM node:lts-trixie-slim AS builder

# Set the working directory to /app
WORKDIR /app

# Copy the current directory contents into the container at /app
COPY package.json yarn.lock .yarnrc.yml tsconfig.json RELEASE_NOTES.md ./
COPY .yarn/releases ./.yarn/releases
COPY ./app /app/app
COPY ./public /app/public
COPY ./src /app/src
COPY ./scripts /app/scripts

ARG NODE_ENV=production
ENV NODE_ENV ${NODE_ENV}
RUN echo Building as $NODE_ENV
# Install any needed packages specified in requirements.txt
RUN apt update && apt upgrade -y
RUN npm install --global nodemon
RUN corepack enable
RUN yarn install --immutable
RUN npx rapidreact build

FROM node:lts-trixie-slim AS runner
WORKDIR /app
COPY --from=builder /app/package.json /app/yarn.lock /app/.yarnrc.yml /app/tsconfig.json /app/RELEASE_NOTES.md ./
COPY --from=builder /app/.yarn/releases ./.yarn/releases
COPY --from=builder /app/app ./app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
COPY --from=builder /app/src ./src
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/scripts ./scripts
COPY ./scripts /app/scripts
RUN chmod +x /app/scripts/*.sh
# Add curl for health check
RUN apt update && apt upgrade -f && apt install curl -y
RUN npm install --global nodemon
RUN corepack enable

ARG NODE_ENV=production
ENV NODE_ENV ${NODE_ENV}
RUN echo Running as $NODE_ENV

# Make port 3000 available to the world outside this container
EXPOSE 3000
# Make port 9229 available to the world for debugging
EXPOSE 9229

# Define environment variable
ENV PORT 3000

# Set a healthcheck to ensure the service is always alive
HEALTHCHECK --interval=10s --timeout=60s --start-period=15s --retries=3 CMD curl -f http://localhost:3000/ || exit 1

# Run app.js when the container launches
CMD ["yarn", "rapidrest", "start", "--docker"]