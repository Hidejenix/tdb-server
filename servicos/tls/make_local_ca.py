"""Cria uma CA local e um certificado de servidor para firestore.googleapis.com.

Uso: python make_local_ca.py
Saida (nesta pasta):
  local_ca.pem        certificado da CA local (este e o PEM a injetar no cliente)
  local_ca.key        chave privada da CA (NAO compartilhar)
  firestore.pem       certificado do servidor (com SAN firestore.googleapis.com)
  firestore.key       chave privada do servidor (NAO compartilhar)
Nao toca no jogo nem no sistema.
"""
from __future__ import annotations

import datetime
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID

DIR = Path(__file__).resolve().parent
HOST = "firestore.googleapis.com"
NOW = datetime.datetime.now(datetime.timezone.utc)


def write_key(path: Path, key) -> None:
    path.write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
    )


def main() -> int:
    ca_key = ec.generate_private_key(ec.SECP256R1())
    ca_name = x509.Name(
        [
            x509.NameAttribute(NameOID.COMMON_NAME, "TDB Local Test CA"),
        ]
    )
    ca_cert = (
        x509.CertificateBuilder()
        .subject_name(ca_name)
        .issuer_name(ca_name)
        .public_key(ca_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(NOW - datetime.timedelta(days=1))
        .not_valid_after(NOW + datetime.timedelta(days=3650))
        .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
        .add_extension(
            x509.KeyUsage(
                digital_signature=True,
                content_commitment=False,
                key_encipherment=False,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=True,
                crl_sign=True,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
        .sign(ca_key, hashes.SHA256())
    )

    srv_key = ec.generate_private_key(ec.SECP256R1())
    srv_cert = (
        x509.CertificateBuilder()
        .subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, HOST)]))
        .issuer_name(ca_name)
        .public_key(srv_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(NOW - datetime.timedelta(days=1))
        .not_valid_after(NOW + datetime.timedelta(days=825))
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(
            x509.KeyUsage(
                digital_signature=True,
                content_commitment=False,
                key_encipherment=False,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=False,
                crl_sign=False,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
        .add_extension(x509.ExtendedKeyUsage([x509.oid.ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
        .add_extension(x509.SubjectAlternativeName([x509.DNSName(HOST)]), critical=False)
        .sign(ca_key, hashes.SHA256())
    )

    (DIR / "local_ca.pem").write_bytes(ca_cert.public_bytes(serialization.Encoding.PEM))
    write_key(DIR / "local_ca.key", ca_key)
    (DIR / "firestore.pem").write_bytes(srv_cert.public_bytes(serialization.Encoding.PEM))
    write_key(DIR / "firestore.key", srv_key)

    print("CA e certificado gerados em", DIR)
    print("SAN:", HOST)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
