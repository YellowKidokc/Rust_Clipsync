FROM rust:1.100-bookworm AS build
WORKDIR /source
COPY . .
RUN cargo build --locked --release -p clipsync-nas

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libssl3 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /source/target/release/clipsync-nas /usr/local/bin/clipsync-nas
USER 10001:10001
ENTRYPOINT ["/usr/local/bin/clipsync-nas"]
CMD ["run"]
