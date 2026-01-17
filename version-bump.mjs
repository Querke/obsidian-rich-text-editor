import { readFileSync, writeFileSync } from "fs";

const requestedBump = process.argv[2];
const bumpLevel = requestedBump ?? "patch";
const shouldPreferPackageVersion = requestedBump === undefined;
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const versions = JSON.parse(readFileSync("versions.json", "utf8"));

const resolveTargetVersion = () => {
	if (shouldPreferPackageVersion) {
		const candidate = process.env.npm_package_version;
		if (candidate) {
			return candidate;
		}
	}

	const currentVersion = manifest.version;
	const [major, minor, patch] = currentVersion
		.split(".")
		.map((value) => Number(value));

	if ([major, minor, patch].some((value) => Number.isNaN(value))) {
		throw new Error(`invalid version string "${currentVersion}"`);
	}

	if (bumpLevel === "major") {
		return `${major + 1}.0.0`;
	}

	if (bumpLevel === "minor") {
		return `${major}.${minor + 1}.0`;
	}

	if (bumpLevel !== "patch") {
		throw new Error(`unsupported bump level "${bumpLevel}"`);
	}

	return `${major}.${minor}.${patch + 1}`;
};

const targetVersion = resolveTargetVersion();
manifest.version = targetVersion;
writeFileSync("manifest.json", JSON.stringify(manifest, null, "\t"));

const { minAppVersion } = manifest;
if (versions[targetVersion] !== minAppVersion) {
	versions[targetVersion] = minAppVersion;
	writeFileSync("versions.json", JSON.stringify(versions, null, "\t"));
}
