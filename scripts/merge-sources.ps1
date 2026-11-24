param(
    [string]$CsvPath = (Join-Path $PSScriptRoot '..\free-3d-model-sites.csv'),
    [string]$UpstreamPath = (Join-Path $PSScriptRoot '..\sources.upstream27.json'),
    [string]$JsonOutput = (Join-Path $PSScriptRoot '..\sources.merged.json'),
    [string]$CsvOutput = (Join-Path $PSScriptRoot '..\sources.merged.csv')
)

$ErrorActionPreference = 'Stop'

function Get-NormalizedHost {
    param([string]$Url)

    $hostName = ([Uri]$Url).Host.ToLowerInvariant().TrimEnd('.')
    return ($hostName -replace '^www\.', '')
}

function Get-SourceId {
    param(
        [string]$Url,
        [string]$DisplayName
    )

    $hostName = Get-NormalizedHost $Url
    $lowerUrl = $Url.ToLowerInvariant()

    if ($lowerUrl -match '^https?://github\.com/polygonalmind(?:/|$)') {
        return 'polygonalmind'
    }

    $hostMap = @{
        'polyhaven.com'             = 'polyhaven'
        'ambientcg.com'             = 'ambientcg'
        'cgbookcase.com'            = 'cgbookcase'
        'sharetextures.com'         = 'sharetextures'
        'blendkit.com'              = 'blenderkit'
        'blenderkit.com'            = 'blenderkit'
        'fab.com'                   = 'fab'
        'kenney.nl'                 = 'kenney'
        'poliigon.com'              = 'poliigon'
        'quaternius.com'            = 'quaternius'
        '3dtextures.me'             = 'threedtextures'
        '3dtexel.com'               = 'threedtexel'
        'texturecan.com'            = 'texturecan'
        'textures.com'              = 'texturescom'
        'hdrmaps.com'               = 'hdrmaps'
        'hdri-hub.com'              = 'hdrihub'
        'cgtrader.com'              = 'cgtrader'
        'turbosquid.com'            = 'turbosquid'
        'itch.io'                   = 'itchio'
        'kaylousberg.itch.io'       = 'itchio'
        'polyfork.dev'              = 'polyfork'
        '3dassets.dev'              = 'threedassets'
        'opengameart.org'           = 'opengameart'
        'sketchfab.com'             = 'sketchfab'
        'freestylized.com'          = 'freestylized'
        'commons.wikimedia.org'     = 'wikimediacommons'
        'grab3d.com'                = 'grab3d'
        'huggingface.co'            = 'scenario'
        'lazytextures.com'          = 'lazytextures'
        'science.nasa.gov'          = 'nasa'
        '3d.si.edu'                 = 'smithsonian'
        'hub.vroid.com'             = 'vroid-hub'
        '3d.nicovideo.jp'           = 'niconi-solid'
        'assetstore.unity.com'      = 'unity-asset-store'
        'assetkitdb.min-inter.co.kr' = 'assetkitdb'
        'cgin.co.kr'                = 'cgin'
        '3d.3d66.com'               = '3d66'
        'models.codelove.in'        = 'codelove'
        'digital.khs.go.kr'         = 'korea-heritage'
        'mlit.go.jp'                = 'plateau'
    }

    if ($hostMap.ContainsKey($hostName)) {
        return $hostMap[$hostName]
    }

    $base = $hostName -replace '[^a-z0-9]+', '-'
    $base = $base.Trim('-')
    if ([string]::IsNullOrWhiteSpace($base)) {
        $base = ($DisplayName.ToLowerInvariant() -replace '[^a-z0-9]+', '-').Trim('-')
    }
    return $base
}

function Add-UniqueValue {
    param(
        [System.Collections.Generic.List[string]]$Values,
        [string]$Value
    )

    if (-not [string]::IsNullOrWhiteSpace($Value) -and -not $Values.Contains($Value)) {
        $Values.Add($Value)
    }
}

$rows = Import-Csv -LiteralPath $CsvPath
$upstream = Get-Content -LiteralPath $UpstreamPath -Raw | ConvertFrom-Json
$sources = [ordered]@{}

foreach ($entry in $upstream) {
    $hostName = Get-NormalizedHost $entry.homepage
    $domains = [System.Collections.Generic.List[string]]::new()
    [void](Add-UniqueValue $domains $hostName)

    $sources[$entry.id] = [ordered]@{
        source_id             = $entry.id
        display_name          = $entry.name
        homepage              = $entry.homepage
        domains               = $domains
        aliases               = @()
        provenance            = [ordered]@{
            upstream_3d_asset_server = [ordered]@{
                source_id = $entry.id
                access    = $entry.access
                added_at  = $entry.addedAt
                added_by  = $entry.addedBy
            }
            user_catalog_row_ids = @()
        }
        user_metadata         = $null
        seed_entries          = @()
        access                = [ordered]@{
            upstream_mode           = $entry.access
            search                  = if ($entry.access -in @('api', 'scrape')) { 'candidate' } else { 'link_only' }
            license_metadata        = 'unverified'
            download                = if ($entry.access -eq 'link') { 'manual_or_external' } else { 'unverified' }
            auth_required           = 'unverified'
            entitlement_required    = 'unverified'
            rate_limit              = 'unverified'
            requires_live_probe     = $true
        }
        connector_status      = 'upstream_integrated'
        enabled               = $true
        notes                 = @()
    }
}

$upstreamOverlaps = [System.Collections.Generic.HashSet[string]]::new()

foreach ($row in $rows) {
    $sourceId = Get-SourceId -Url $row.'网址' -DisplayName $row.'名称'
    $hostName = Get-NormalizedHost $row.'网址'

    if (-not $sources.Contains($sourceId)) {
        $sources[$sourceId] = [ordered]@{
            source_id             = $sourceId
            display_name          = $row.'名称'
            homepage              = $row.'网址'
            domains               = [System.Collections.Generic.List[string]]::new()
            aliases               = @()
            provenance            = [ordered]@{
                upstream_3d_asset_server = $null
                user_catalog_row_ids = @()
            }
            user_metadata         = $null
            seed_entries          = @()
            access                = [ordered]@{
                upstream_mode           = $null
                search                  = 'unverified'
                license_metadata        = 'unverified'
                download                = 'unverified'
                auth_required           = 'unverified'
                entitlement_required    = 'unverified'
                rate_limit              = 'unverified'
                requires_live_probe     = $true
            }
            connector_status      = 'seed_unverified'
            enabled               = $false
            notes                 = @()
        }
    } else {
        if ($null -ne $sources[$sourceId].provenance.upstream_3d_asset_server) {
            [void]$upstreamOverlaps.Add($sourceId)
        }
    }

    $source = $sources[$sourceId]
    [void](Add-UniqueValue $source.domains $hostName)

    $rowIds = [System.Collections.Generic.List[object]]::new()
    if ($null -ne $source.provenance.user_catalog_row_ids) {
        foreach ($id in @($source.provenance.user_catalog_row_ids)) {
            $rowIds.Add($id)
        }
    }
    if (-not $rowIds.Contains($row.'编号')) {
        $rowIds.Add($row.'编号')
    }
    $source.provenance.user_catalog_row_ids = @($rowIds)

    if ($null -eq $source.user_metadata) {
        $source.user_metadata = [ordered]@{
            region_language = $row.'地区语言'
            license_summary = $row.'免费许可'
            formats         = $row.'格式'
            recommended_use = $row.'推荐用途'
            notes           = $row.'备注'
        }
    }

    $seedEntries = [System.Collections.Generic.List[object]]::new()
    foreach ($seed in @($source.seed_entries)) {
        $seedEntries.Add($seed)
    }
    $seedEntries.Add([ordered]@{
        row_id          = $row.'编号'
        name            = $row.'名称'
        url             = $row.'网址'
        region_language = $row.'地区语言'
        license_summary = $row.'免费许可'
        formats         = $row.'格式'
        recommended_use = $row.'推荐用途'
        notes           = $row.'备注'
    })
    $source.seed_entries = @($seedEntries)

    if ($source.homepage -ne $row.'网址') {
        $aliases = [System.Collections.Generic.List[object]]::new()
        foreach ($alias in @($source.aliases)) {
            $aliases.Add($alias)
        }
        if (-not ($aliases | Where-Object { $_.url -eq $row.'网址' })) {
            $aliases.Add([ordered]@{
                name = $row.'名称'
                url  = $row.'网址'
                kind = 'user_catalog_alias'
            })
        }
        $source.aliases = @($aliases)
    }
}

$mergedSources = @($sources.Values | Sort-Object {
    if ($null -ne $_.provenance.upstream_3d_asset_server) { 0 } else { 1 }
}, source_id)

$document = [ordered]@{
    schema_version = '1.0'
    generated_at   = (Get-Date).ToString('yyyy-MM-ddTHH:mm:sszzz')
    inputs         = [ordered]@{
        user_catalog_rows = $rows.Count
        upstream_sources  = $upstream.Count
    }
    merge_summary  = [ordered]@{
        raw_input_rows         = $rows.Count
        upstream_sources       = $upstream.Count
        merged_sources         = $mergedSources.Count
        user_unique_sources    = @($mergedSources | Where-Object { $_.provenance.user_catalog_row_ids.Count -gt 0 }).Count
        overlap_source_count   = $upstreamOverlaps.Count
        upstream_only_sources  = @($mergedSources | Where-Object { $null -ne $_.provenance.upstream_3d_asset_server -and $_.provenance.user_catalog_row_ids.Count -eq 0 }).Count
        user_only_sources      = @($mergedSources | Where-Object { $null -eq $_.provenance.upstream_3d_asset_server -and $_.provenance.user_catalog_row_ids.Count -gt 0 }).Count
    }
    merge_rules     = @(
        'Provenance is preserved; merged records never discard the original source rows.',
        'Canonical site IDs are based on verified aliases first, then normalized host names.',
        'Sub-site and category URLs are stored as aliases instead of creating duplicate sources.',
        'User-only seed records remain disabled until a live access, license, and download probe succeeds.',
        'Authentication and entitlement fields remain unverified until site-specific probes are implemented.'
    )
    sources        = $mergedSources
}

$document | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $JsonOutput -Encoding utf8

$csvRows = foreach ($source in $mergedSources) {
    [pscustomobject]@{
        source_id          = $source.source_id
        display_name       = $source.display_name
        homepage           = $source.homepage
        domains            = (@($source.domains) -join ';')
        upstream_access    = $source.access.upstream_mode
        connector_status   = $source.connector_status
        user_catalog_ids   = (@($source.provenance.user_catalog_row_ids) -join ';')
        aliases            = (@($source.aliases | ForEach-Object { $_.url }) -join ';')
    }
}
$csvRows | Export-Csv -LiteralPath $CsvOutput -NoTypeInformation -Encoding utf8

$document.merge_summary | Format-List | Out-String
