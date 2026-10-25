import { Data, NtExecutable, NtExecutableResource, Resource } from "resedit";

/** Gives Node's Windows executable the app's icon, name, and version, and no console window. */
export function brandWindowsExecutable(
	node: Uint8Array,
	{ icon, name, version }: Readonly<{ icon: Uint8Array; name: string; version: string }>,
): Uint8Array {
	const executable = NtExecutable.from(node, { ignoreCert: true });
	const resources = NtExecutableResource.from(executable);
	const [iconGroup] = Resource.IconGroupEntry.fromEntries(resources.entries);
	const [versionInfo] = Resource.VersionInfo.fromEntries(resources.entries);
	if (!iconGroup || !versionInfo) {
		throw new Error("Node's executable has no icon or version information");
	}
	Resource.IconGroupEntry.replaceIconsForResource(
		resources.entries,
		iconGroup.id,
		iconGroup.lang,
		Data.IconFile.from(icon).icons.map(({ data }) => data),
	);
	const [major = 0, minor = 0, patch = 0] = version.split(/[.-]/u).map(Number);
	versionInfo.setFileVersion(major, minor, patch, 0);
	versionInfo.setProductVersion(major, minor, patch, 0);
	for (const language of versionInfo.getAllLanguagesForStringValues()) {
		versionInfo.removeStringValue(language, "CompanyName");
		versionInfo.setStringValues(language, {
			FileDescription: name,
			ProductName: name,
			ProductVersion: version,
			FileVersion: version,
			InternalName: "signal-stickers",
			OriginalFilename: "signal-stickers.exe",
		});
	}
	versionInfo.outputToResourceEntries(resources.entries);
	resources.outputResource(executable);
	executable.newHeader.optionalHeader.subsystem = WINDOWS_GUI_SUBSYSTEM;
	return new Uint8Array(executable.generate());
}

/** Windows opens no console window for a program of this subsystem. */
const WINDOWS_GUI_SUBSYSTEM = 2;
