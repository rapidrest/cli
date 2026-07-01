#!/bin/sh
PROFILE_DIR="${PROFILE_DIR:-/profiles}"

echo "Starting node with CPU profiling (output: $PROFILE_DIR)..."

node --cpu-prof "$@" &
NODE_PID=$!
echo "Node PID: $NODE_PID"

save_profile() {
    echo "Waiting for node to exit..."
    wait "$NODE_PID" 2>/dev/null || true
    echo "Copying .cpuprofile files..."
    find "$(pwd)" -maxdepth 1 -name '*.cpuprofile' -exec cp -v {} "$PROFILE_DIR/" \;
    COUNT=$(find "$PROFILE_DIR" -name '*.cpuprofile' | wc -l)
    echo "Done. $COUNT profile(s) saved to $PROFILE_DIR"
}

trap 'echo "SIGTERM received"; kill -TERM $NODE_PID 2>/dev/null; save_profile; exit 0' TERM
trap 'echo "SIGINT received";  kill -INT  $NODE_PID 2>/dev/null; save_profile; exit 0' INT

wait "$NODE_PID" || true
echo "Node exited (no signal)"
save_profile
