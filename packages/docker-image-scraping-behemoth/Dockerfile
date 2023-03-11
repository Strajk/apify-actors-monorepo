FROM apify/actor-node-playwright-firefox:16

USER myuser
COPY --chown=myuser:myuser package.json /home/myuser/

RUN npm --quiet set progress=false \
  && npm install --only=prod --no-optional

# Patch header-generator
# @see https://github.com/apify/got-scraping/issues/65#issuecomment-1463957669
# Beware that replacting in-place with jq is quite tricky: https://github.com/stedolan/jq/wiki/FAQ#general-questions
USER root
RUN DEBIAN_FRONTEND=noninteractive apt-get update && apt-get install -y --no-install-recommends jq
RUN jq 'map_values(["Host"] + .)' /home/myuser/node_modules/header-generator/data_files/headers-order.json > tmp.json && mv tmp.json /home/myuser/node_modules/header-generator/data_files/headers-order.json




