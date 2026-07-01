{{/* vim: set filetype=mustache: */}}
{{/*
Expand the name of the chart.
*/}}
{{- define "rrst.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "rrst.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "rrst.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Common labels
*/}}
{{- define "rrst.labels" -}}
app.kubernetes.io/name: {{ include "rrst.name" . }}
helm.sh/chart: {{ include "rrst.chart" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{/*
Renders a value that contains template.
Usage:
{{ include "rrst.render" ( dict "value" .Values.path.to.the.Value "context" $) }}
*/}}
{{- define "rrst.render" -}}
    {{- if typeIs "string" .value }}
        {{- tpl .value .context }}
    {{- else }}
        {{- tpl (.value | toYaml) .context }}
    {{- end }}
{{- end -}}

{{/*
Generate certificates for nginx
*/}}
{{- define "rrst.gen-nginx-certs" -}}
{{- $ca := genCA "xbe-ca" 365 -}}
{{- $cert := genSignedCert . nil nil 365 $ca -}}
tls.crt: {{ $cert.Cert | b64enc }}
tls.key: {{ $cert.Key | b64enc }}
{{- end -}}

{{/*
Generate list of domains with subdomain and/or path
*/}}
{{- define "rrst.domains" -}}
{{- $Values := .Values }}
{{- $SubDomain := "" }}
{{- if and .system (hasKey .system "host_subdomain") }}
    {{- $SubDomain = .system.host_subdomain }}
{{- end -}}
{{- $Path := "" }}
{{- if .path }}
    {{- $Path = .path }}
{{- end -}}
{{- $Protocol := "" }}
{{- if .protocol }}
    {{- $Protocol = .protocol }}
{{- end -}}
{{- $NewDomains := list  }}
{{- $CurrentDomains := list $Values.domain }}
{{- if and (hasKey $Values "alias_domains") (kindIs "slice" $Values.alias_domains)}}
{{- $CurrentDomains = concat $CurrentDomains $Values.alias_domains -}}
{{- end -}}
{{- range $domain := $CurrentDomains -}}
    {{- if $SubDomain }}
    {{- $domain = printf "%s.%s" $SubDomain (tpl $domain $Values) -}}
    {{- else}}
    {{- $domain = printf "%s" (tpl $domain $Values) -}}
    {{- end}}
    {{- if $Protocol }}
    {{- $domain = printf "%s://%s" $Protocol $domain -}}
    {{- end}}
    {{- if $Path }}
    {{- $domain = printf "%s%s" $domain $Path -}}
    {{- end}}
    {{- $NewDomains = append $NewDomains $domain -}}
{{- end -}}
{{ $NewDomains | toJson }}
{{- end -}}
{{/*
Generate list of domains with subdomain and/or path
*/}}

{{- define "rrst.domains.ingress" -}}
{{- $Values := .Values }}
{{- $System := .Values.ingress }}
{{- include "rrst.domains" (dict "Values" $.Values "system" $System) }}
{{- end -}}