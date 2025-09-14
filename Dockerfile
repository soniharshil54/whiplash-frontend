FROM node:20-alpine AS build

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

# Copy .env file if it exists (for local development)
COPY .env* ./

# Set environment variables for build
ARG VITE_SAMPLE_ENV_KEY
ARG VITE_API_URL
ENV VITE_SAMPLE_ENV_KEY=$VITE_SAMPLE_ENV_KEY
ENV VITE_API_URL=$VITE_API_URL

RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
