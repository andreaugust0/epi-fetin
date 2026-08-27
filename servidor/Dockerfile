FROM python:3.12-slim

# Impede o Python de gravar .pyc e de bufferizar a saída — sem o segundo,
# os logs do contêiner só aparecem quando o buffer enche, o que atrapalha
# muito na hora de depurar.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Dependências primeiro, código depois: assim o layer do pip só é
# reconstruído quando requirements.txt muda, não a cada edição de código.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY scripts ./scripts

# Usuário sem privilégios. Rodar como root dentro do contêiner é o padrão
# e é desnecessário aqui.
RUN useradd --create-home --uid 1000 epi && chown -R epi:epi /app
USER epi

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
