FROM node:22-alpine AS base
WORKDIR /repo
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json* npm-shrinkwrap.json* ./
COPY tsconfig.base.json ./
COPY packages/table/package.json ./packages/table/package.json
COPY packages/preprocessing/package.json ./packages/preprocessing/package.json
COPY packages/models/package.json ./packages/models/package.json
COPY packages/runtime/package.json ./packages/runtime/package.json
COPY packages/prediction/package.json ./packages/prediction/package.json
COPY tests/integration/package.json ./tests/integration/package.json
COPY apps/google-sheets/package.json ./apps/google-sheets/package.json
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

FROM base AS test
CMD ["npm", "run", "test", "--workspace=tests-integration"]

FROM base AS app
EXPOSE 5173
CMD ["npm", "run", "dev", "--workspace=google-sheets", "--", "--host", "0.0.0.0", "--port", "5173"]
