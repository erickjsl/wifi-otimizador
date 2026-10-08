"""Módulo de Certificação Profissional de Rede Wi-Fi.

Permite cadastrar o cliente/local, definir critérios de SLA (padrão residencial
ou empresarial), coletar as medições de cada cômodo/ponto do ambiente e gerar
o Laudo Técnico / Certificado de Conformidade Wi-Fi em HTML/PDF para impressão.
"""
import datetime
import json, secrets


DEFAULT_SLA = {
    "residencial_padrao": {
        "name": "Residencial Padrão",
        "min_rssi": -67,       # dBm (mínimo para streaming HD/chamadas)
        "max_latency": 45,     # ms até o roteador/gateway
        "max_loss": 1.0,       # % de perda de pacotes
        "min_speed_pct": 40.0, # % da velocidade do link Wi-Fi contratado/negociado
        "allowed_bands": ["2.4", "5", "6"],
    },
    "residencial_premium": {
        "name": "Residencial High-End / Home Office",
        "min_rssi": -60,       # dBm (excelente em todos os pontos)
        "max_latency": 20,     # ms (jogos e videochamadas 4K)
        "max_loss": 0.0,       # 0% de perda
        "min_speed_pct": 60.0,
        "allowed_bands": ["5", "6"], # exige 5 GHz / 6 GHz
    },
    "corporativo": {
        "name": "Corporativo / Comercial",
        "min_rssi": -65,
        "max_latency": 15,
        "max_loss": 0.0,
        "min_speed_pct": 70.0,
        "allowed_bands": ["5", "6"],
    }
}


def evaluate_point(point, sla):
    """Avalia um ponto individual contra os critérios de SLA."""
    rssi = point.get("rssi")
    latency = point.get("latency_gw")
    loss = point.get("loss_gw", 0.0)
    band = point.get("band", "")

    issues = []
    if rssi is None or rssi < sla["min_rssi"]:
        issues.append(f"Sinal fraco: {rssi} dBm (mínimo exigido: {sla['min_rssi']} dBm)")

    if latency is not None and latency > sla["max_latency"]:
        issues.append(f"Latência alta até o roteador: {latency:.1f} ms (máximo: {sla['max_latency']} ms)")

    if loss > sla["max_loss"]:
        issues.append(f"Perda de pacotes: {loss:.1f}% (máximo tolerado: {sla['max_loss']}%)")

    if band and band not in sla["allowed_bands"]:
        issues.append(f"Banda {band} GHz não recomendada para este perfil de certificação")

    passed = len(issues) == 0
    return {
        "passed": passed,
        "issues": issues,
        "score": max(0, 100 - len(issues) * 25)
    }


def generate_certificate_data(client_info, points, sla_key="residencial_padrao"):
    """Gera a estrutura completa de dados da certificação."""
    sla = DEFAULT_SLA.get(sla_key, DEFAULT_SLA["residencial_padrao"])
    cert_id = f"CERT-WIFI-{datetime.datetime.now().strftime('%Y%m%d')}-{secrets.token_hex(3).upper()}"

    evaluated_points = []
    total_score = 0

    for pt in points:
        eval_res = evaluate_point(pt, sla)
        pt_copy = dict(pt)
        pt_copy["eval"] = eval_res
        evaluated_points.append(pt_copy)
        total_score += eval_res["score"]

    avg_score = int(total_score / len(evaluated_points)) if evaluated_points else 0
    all_passed = all(pt["eval"]["passed"] for pt in evaluated_points) if evaluated_points else False

    status = "APROVADO" if (all_passed and len(evaluated_points) > 0) else "REPROVADO"

    return {
        "cert_id": cert_id,
        "date": datetime.datetime.now().strftime("%d/%m/%Y %H:%M"),
        "client": {
            "name": client_info.get("name", "Cliente não identificado"),
            "address": client_info.get("address", "Endereço não informado"),
            "technician": client_info.get("technician", "Técnico Responsável"),
            "ssid": client_info.get("ssid", "Rede Wi-Fi"),
            "contracted_speed": client_info.get("contracted_speed", "Não informado")
        },
        "sla": sla,
        "status": status,
        "overall_score": avg_score,
        "total_points": len(evaluated_points),
        "passed_points": sum(1 for pt in evaluated_points if pt["eval"]["passed"]),
        "points": evaluated_points
    }
