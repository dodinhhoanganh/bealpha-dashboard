FROM golang:1.26.6-alpine AS gosu-builder
RUN CGO_ENABLED=0 go install github.com/tianon/gosu@6456aaa0f3c854d199d0f037f068eb97515b7513

FROM postgres:16-alpine
RUN apk upgrade --no-cache
COPY --from=gosu-builder /go/bin/gosu /usr/local/bin/gosu
