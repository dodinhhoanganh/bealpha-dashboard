FROM nginx:1.29-alpine

# Install all published Alpine security fixes in the immutable runtime image.
RUN apk upgrade --no-cache
