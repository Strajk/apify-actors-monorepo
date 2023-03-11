docker rm -f benemoth-test-container
docker build -t benemoth-test .
docker create --name benemoth-test-container benemoth-test
docker cp benemoth-test-container:/home/myuser/node_modules/header-generator/data_files/headers-order.json .
# Test that the Host header is present
grep -q "Host" headers-order.json || echo "BEWARE: Host not found in headers-order.json"
