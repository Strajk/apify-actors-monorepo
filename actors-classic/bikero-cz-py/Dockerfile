FROM python:3.10-bullseye

RUN pip install --no-cache-dir poetry

WORKDIR /usr/src/app

COPY poetry.lock pyproject.toml ./

RUN poetry config virtualenvs.create false \
    && poetry install --only main --no-interaction --no-ansi

COPY . .
CMD ["scrapy", "runspider", "main.py"]
