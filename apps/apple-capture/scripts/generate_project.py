#!/usr/bin/env python3
"""Generate the committed Xcode project without a third-party generator dependency."""
import hashlib
import plistlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
objects = {}

def uid(name):
    return hashlib.sha256(name.encode()).hexdigest()[:24].upper()

def add(object_name, isa, **values):
    key = uid(object_name)
    objects[key] = {"isa": isa, **values}
    return key

def file(path, file_type):
    return add("file:" + path, "PBXFileReference", lastKnownFileType=file_type, path=path, sourceTree="<group>")

def build_file(name, ref, **values):
    return add("build:" + name, "PBXBuildFile", fileRef=ref, **values)

def configs(name, settings):
    children = []
    for config in ["Debug", "Release"]:
        flags = dict(settings)
        flags.update(SWIFT_OPTIMIZATION_LEVEL="-Onone" if config == "Debug" else "-O")
        children.append(add(name + config, "XCBuildConfiguration", buildSettings=flags, name=config))
    return add(name + "configs", "XCConfigurationList", buildConfigurations=children,
               defaultConfigurationIsVisible=0, defaultConfigurationName="Release")

core_paths = sorted(str(p.relative_to(ROOT)) for p in (ROOT / "Sources/CaptureCore").glob("*.swift"))
paths = core_paths + sorted(str(p.relative_to(ROOT)) for folder in ["iOS", "Watch"] for p in (ROOT / folder).glob("*.swift"))
refs = {p: file(p, "sourcecode.swift") for p in paths}
privacy = file("Config/PrivacyInfo.xcprivacy", "text.xml")
config_refs = [file("Config/" + p, "text.plist.xml") for p in ["iOS-Info.plist", "Watch-Info.plist", "HealthKit.entitlements"]]
products = {name: add(name + "product", "PBXFileReference", explicitFileType="wrapper.application", includeInIndex=0, path=name + ".app", sourceTree="BUILT_PRODUCTS_DIR") for name in ["SafetyCapture", "SafetyWatch"]}
product_group = add("products", "PBXGroup", children=list(products.values()), name="Products", sourceTree="<group>")
main_group = add("main", "PBXGroup", children=list(refs.values()) + [privacy] + config_refs + [product_group], sourceTree="<group>")
common = {
    "SWIFT_VERSION": "5.0", "SWIFT_STRICT_CONCURRENCY": "targeted", "CODE_SIGN_STYLE": "Automatic",
    "CURRENT_PROJECT_VERSION": "1", "MARKETING_VERSION": "0.1.0", "GENERATE_INFOPLIST_FILE": "NO",
    "CODE_SIGN_ENTITLEMENTS": "Config/HealthKit.entitlements", "PRODUCT_NAME": "$(TARGET_NAME)",
    "SWIFT_EMIT_LOC_STRINGS": "YES", "ENABLE_USER_SCRIPT_SANDBOXING": "YES",
}
for name, folder, platform, deployment, bundle in [
    ("SafetyWatch", "Watch", "watchos", "WATCHOS_DEPLOYMENT_TARGET", "org.hackmit.safetycapture.watchkitapp"),
    ("SafetyCapture", "iOS", "iphoneos", "IPHONEOS_DEPLOYMENT_TARGET", "org.hackmit.safetycapture"),
]:
    files = [p for p in paths if p in core_paths or p.startswith(folder + "/")]
    sources = add(name + "sources", "PBXSourcesBuildPhase", buildActionMask=2147483647,
                  files=[build_file(name + p, refs[p]) for p in files], runOnlyForDeploymentPostprocessing=0)
    resources = add(name + "resources", "PBXResourcesBuildPhase", buildActionMask=2147483647,
                    files=[build_file(name + "privacy", privacy)], runOnlyForDeploymentPostprocessing=0)
    frameworks = add(name + "frameworks", "PBXFrameworksBuildPhase", buildActionMask=2147483647, files=[], runOnlyForDeploymentPostprocessing=0)
    phases = [sources, frameworks, resources]
    dependencies = []
    if name == "SafetyCapture":
        proxy = add("watchProxy", "PBXContainerItemProxy", containerPortal=uid("project"), proxyType=1,
                    remoteGlobalIDString=uid("SafetyWatchtarget"), remoteInfo="SafetyWatch")
        dependencies = [add("watchDependency", "PBXTargetDependency", target=uid("SafetyWatchtarget"), targetProxy=proxy)]
        phases.append(add("embedWatch", "PBXCopyFilesBuildPhase", buildActionMask=2147483647,
                          dstPath="$(CONTENTS_FOLDER_PATH)/Watch", dstSubfolderSpec=16,
                          files=[build_file("embedWatch", products["SafetyWatch"], settings={"ATTRIBUTES": ["RemoveHeadersOnCopy"]})],
                          name="Embed Watch Content", runOnlyForDeploymentPostprocessing=0))
    settings = dict(common, SDKROOT=platform, PRODUCT_BUNDLE_IDENTIFIER=bundle,
                    INFOPLIST_FILE=f"Config/{folder}-Info.plist", TARGETED_DEVICE_FAMILY="4" if folder == "Watch" else "1",
                    SUPPORTED_PLATFORMS="watchos watchsimulator" if folder == "Watch" else "iphoneos iphonesimulator")
    settings[deployment] = "10.0" if folder == "Watch" else "17.0"
    if folder == "Watch": settings["SKIP_INSTALL"] = "YES"
    add(name + "target", "PBXNativeTarget", buildConfigurationList=configs(name, settings), buildPhases=phases,
        buildRules=[], dependencies=dependencies, name=name, productName=name, productReference=products[name],
        productType="com.apple.product-type.application")

add("project", "PBXProject", attributes={"BuildIndependentTargetsInParallel": "YES", "LastUpgradeCheck": "1600",
    "TargetAttributes": {uid(name + "target"): {"SystemCapabilities": {"com.apple.HealthKit": {"enabled": 1}}} for name in products}},
    buildConfigurationList=configs("project", {"CLANG_ENABLE_MODULES": "YES", "ENABLE_STRICT_OBJC_MSGSEND": "YES"}),
    compatibilityVersion="Xcode 14.0", developmentRegion="en", hasScannedForEncodings=0,
    knownRegions=["en", "Base"], mainGroup=main_group, productRefGroup=product_group, projectDirPath="", projectRoot="",
    targets=[uid("SafetyCapturetarget"), uid("SafetyWatchtarget")])

def serialize(value, depth=0):
    if isinstance(value, dict):
        return "{\n" + "".join("\t" * (depth+1) + serialize(k) + " = " + serialize(v, depth+1) + ";\n" for k, v in value.items()) + "\t" * depth + "}"
    if isinstance(value, list):
        return "(" + ", ".join(serialize(item, depth) for item in value) + ")"
    if isinstance(value, int): return str(value)
    return '"' + str(value).replace('\\', '\\\\').replace('"', '\\"') + '"'

project = ROOT / "SafetyCapture.xcodeproj"
project.mkdir(exist_ok=True)
(project / "project.pbxproj").write_text("// !$*UTF8*$!\n" + serialize({"archiveVersion": 1, "classes": {}, "objectVersion": 56, "objects": objects, "rootObject": uid("project")}) + "\n")
schemes = project / "xcshareddata/xcschemes"
schemes.mkdir(parents=True, exist_ok=True)
for name in products:
    reference = f'<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{uid(name + "target")}" BuildableName="{name}.app" BlueprintName="{name}" ReferencedContainer="container:SafetyCapture.xcodeproj"/>'
    (schemes / (name + ".xcscheme")).write_text(f'''<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="1600" version="1.7">
<BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES">{reference}</BuildActionEntry></BuildActionEntries></BuildAction>
<TestAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv="YES"/>
<LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" allowLocationSimulation="YES"><BuildableProductRunnable runnableDebuggingMode="0">{reference}</BuildableProductRunnable></LaunchAction>
<ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES" savedToolIdentifier="" useCustomWorkingDirectory="NO" debugDocumentVersioning="YES"><BuildableProductRunnable runnableDebuggingMode="0">{reference}</BuildableProductRunnable></ProfileAction>
<AnalyzeAction buildConfiguration="Debug"/><ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/>
</Scheme>
''')
print(project)
